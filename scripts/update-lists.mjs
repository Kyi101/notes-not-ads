import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';

// Chrome documents a guaranteed minimum of 30000 static rules per extension,
// which earlier code treated as a hard cap. It is a floor: the real budget is a
// shared pool. Probed at 52094 rules the ruleset loaded with 277723 pool slots
// still free. Keep a ceiling anyway — Chrome drops an oversized ruleset whole,
// which fails far worse than truncation.
const STATIC_RULE_CEILING = 60000;
const GENERATED_COSMETIC_RULE_LIMIT = 5000;
const writeChanges = process.argv.includes('--write');

const BLOCK_RESOURCE_TYPES = [
  'script', 'image', 'xmlhttprequest', 'sub_frame',
  'ping', 'media', 'websocket', 'other'
];

// EasyList option -> DNR resource type. Options absent here either have no DNR
// equivalent ($popup) or do not narrow the match ($third-party), and are
// handled explicitly in parseException.
const EXCEPTION_TYPE_OPTIONS = {
  script: 'script',
  image: 'image',
  stylesheet: 'stylesheet',
  xmlhttprequest: 'xmlhttprequest',
  subdocument: 'sub_frame',
  media: 'media',
  font: 'font',
  ping: 'ping',
  websocket: 'websocket',
  other: 'other',
  object: 'object'
};

const EXCEPTION_IGNORED_OPTIONS = new Set([
  'third-party', '3p', 'first-party', '1p', 'important', 'all', 'document'
]);

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

export function parseRules(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!'));

  const dnrRules = [];
  const cosmeticRules = [];
  const blockedDomains = new Set();
  let ruleId = 100;

  for (const line of lines) {
    if (line.includes('##') || line.includes('#@#')) {
      cosmeticRules.push(line);
      continue;
    }

    if (line.startsWith('||') && line.endsWith('^') && !line.includes('*') && !line.includes('/')) {
      const domain = line.slice(2, -1);
      if (blockedDomains.has(domain)) continue;
      blockedDomains.add(domain);
      dnrRules.push({
        id: ruleId++,
        priority: 1,
        action: { type: 'block' },
        condition: { urlFilter: `||${domain}`, resourceTypes: [...BLOCK_RESOURCE_TYPES] }
      });
    }
  }

  // Exceptions run in a second pass so they can be scoped to what pass one
  // actually blocked. Without them a blanket block on hosts like
  // imasdk.googleapis.com or g.doubleclick.net breaks video playback and page
  // layout on the sites EasyList explicitly carves out.
  let exceptionCount = 0;
  for (const line of lines) {
    if (!line.startsWith('@@')) continue;
    const condition = parseException(line, blockedDomains);
    if (!condition) continue;
    dnrRules.push({ id: ruleId++, priority: 2, action: { type: 'allow' }, condition });
    exceptionCount += 1;
  }

  assertDnrRulesetWithinCeiling(dnrRules, 'generated EasyList DNR');
  return {
    dnrRules,
    exceptionCount,
    cosmeticRules: cosmeticRules.slice(0, GENERATED_COSMETIC_RULE_LIMIT)
  };
}

// Returns a DNR condition for an @@ exception, or null when the exception
// cannot be expressed safely. Unscoped allow rules are never emitted: one would
// silently unblock a tracker on every site.
export function parseException(line, blockedDomains) {
  const body = line.slice(2);
  const optionStart = body.lastIndexOf('$');
  const pattern = optionStart > -1 ? body.slice(0, optionStart) : body;
  const optionText = optionStart > -1 ? body.slice(optionStart + 1) : '';

  if (!pattern.startsWith('||')) return null;
  if (!/^[\x20-\x7e]+$/.test(pattern)) return null;

  const host = pattern.slice(2).split(/[/^*]/)[0];
  if (!blockedDomains.has(host)) return null;

  let initiatorDomains = null;
  const resourceTypes = [];

  for (const option of optionText ? optionText.split(',') : []) {
    if (option.startsWith('domain=')) {
      const values = option.slice(7).split('|');
      // A negated entry inverts the scope into "everywhere except", which has
      // no scoped-allow equivalent. Drop the whole exception rather than
      // widening it.
      if (values.some(v => v.startsWith('~'))) return null;
      initiatorDomains = values.filter(Boolean).map(v => v.toLowerCase());
      continue;
    }
    if (EXCEPTION_TYPE_OPTIONS[option]) {
      resourceTypes.push(EXCEPTION_TYPE_OPTIONS[option]);
      continue;
    }
    if (EXCEPTION_IGNORED_OPTIONS.has(option)) continue;
    return null;
  }

  if (!initiatorDomains?.length) return null;
  if (initiatorDomains.some(domain => !/^[a-z0-9.\-]+$/.test(domain))) return null;

  const condition = { urlFilter: pattern, initiatorDomains };
  if (resourceTypes.length) condition.resourceTypes = resourceTypes;
  return condition;
}

function assertDnrRulesetWithinCeiling(rules, label) {
  if (rules.length > STATIC_RULE_CEILING) {
    throw new Error(
      `${label} has ${rules.length} rules; Chrome drops an oversized static ruleset whole, so this build keeps it at or below ${STATIC_RULE_CEILING}.`
    );
  }
}

async function main() {
  const text = await fetchUrl(EASYLIST_URL);
  const { dnrRules, exceptionCount, cosmeticRules } = parseRules(text);

  if (!writeChanges) {
    console.log(
      `[dry] parsed ${dnrRules.length} DNR rules (${dnrRules.length - exceptionCount} block, ${exceptionCount} scoped allow) and ${cosmeticRules.length} cosmetic rules from EasyList.`
    );
    console.log('Run `node scripts/update-lists.mjs --write` to update local generated lists.');
    return;
  }
  
  // Written minified: at ~52k rules the indented form costs ~12MB of package
  // and repo weight for a file no human reviews line by line. lint-dnr-rules.mjs
  // is the review mechanism.
  const dnrPath = path.join(root, 'rules', 'easylist_dnr.json');
  fs.writeFileSync(dnrPath, JSON.stringify(dnrRules));
  
  const cosmeticJsPath = path.join(root, 'src', 'cosmetic-filters.js');
  const jsContent = fs.readFileSync(cosmeticJsPath, 'utf8');

  if (!COSMETIC_DECLARATION_REGEX.test(jsContent)) {
    throw new Error(
      'DEFAULT_COSMETIC_FILTER_TEXT declaration not found in src/cosmetic-filters.js; refusing to write.'
    );
  }

  const declaration = serializeCosmeticFilterDeclaration([
    ...SEED_COSMETIC_LINES,
    '! --- EASYLIST ---',
    ...cosmeticRules
  ]);

  fs.writeFileSync(
    cosmeticJsPath,
    jsContent.replace(COSMETIC_DECLARATION_REGEX, () => declaration)
  );
}

const SEED_COSMETIC_LINES = [
  '',
  '! Attention Redirector seed rules plus a local cosmetic snapshot.',
  '! DNR network rules live in rules/*.json; every cosmetic match still passes safety checks.',
  '##.adsbygoogle',
  '##ins.adsbygoogle',
  '##.adthrive-ad',
  '##.ad-container',
  '##.ad-wrapper',
  '##.ad-slot',
  '##.ad-banner',
  '##.advertisement',
  '##.advertising',
  '##.sponsored-ad',
  '##[data-ad-slot]',
  '##[aria-label="Advertisement"]',
  '##[id^="google_ads_iframe_"]',
  '##[id*="google_ads_iframe"]',
  '##[id^="div-gpt-ad"]',
  '##[id*="div-gpt-ad"]',
  'merriam-webster.com##.adthrive-ad',
  'pravda.com.ua##.ima-ad-container',
  'amazon.com##.s-left-ads-item',
  'pexels.com##[class*="Inline_container__"]',
  'pexels.com##[class*="FullWidth_wrapper__"]',
  'pexels.com##[class*="AIGCShared_container__"]',
  'unsplash.com##[data-ad="true"]',
  'adblock.turtlecute.org##.adbox.banner_ads.adsbox',
  'adblock.turtlecute.org##.textads',
  '127.0.0.1##[data-ad="true"]',
  '127.0.0.1##.commercial-unit',
  '127.0.0.1###cosmetic-only-slot'
];

// Matches the legacy template-literal form and the current .join("\n") array form.
export const COSMETIC_DECLARATION_REGEX =
  /const DEFAULT_COSMETIC_FILTER_TEXT = (?:`[\s\S]*?`|\[[\s\S]*?\n\s*\]\.join\("\\n"\));/;

// Filter lines are stored as JSON-escaped strings, never a template literal:
// upstream EasyList text must not be able to interpolate or execute in the
// content script.
export function serializeCosmeticFilterDeclaration(lines) {
  return (
    'const DEFAULT_COSMETIC_FILTER_TEXT = [\n' +
    lines.map((line) => `    ${JSON.stringify(String(line))}`).join(',\n') +
    '\n  ].join("\\n");'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
