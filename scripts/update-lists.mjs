import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';
const MAX_STATIC_RULES_PER_RULESET = 30000;
const GENERATED_DNR_RULE_LIMIT = 5000;
const GENERATED_COSMETIC_RULE_LIMIT = 5000;
const writeChanges = process.argv.includes('--write');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseRules(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!'));
  
  const dnrRules = [];
  const cosmeticRules = [];
  
  let ruleId = 100;

  for (const line of lines) {
    if (line.includes('##') || line.includes('#@#')) {
      cosmeticRules.push(line);
      continue;
    }
    
    if (line.startsWith('||') && line.endsWith('^') && !line.includes('*') && !line.includes('/')) {
      const domain = line.slice(2, -1);
      dnrRules.push({
        id: ruleId++,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: `||${domain}`,
          resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping', 'media', 'websocket', 'other']
        }
      });
    }
    if (dnrRules.length >= GENERATED_DNR_RULE_LIMIT) break;
  }

  assertDnrRulesetWithinCap(dnrRules, 'generated EasyList DNR');
  return {
    dnrRules,
    cosmeticRules: cosmeticRules.slice(0, GENERATED_COSMETIC_RULE_LIMIT)
  };
}

function assertDnrRulesetWithinCap(rules, label) {
  if (rules.length > MAX_STATIC_RULES_PER_RULESET) {
    throw new Error(
      `${label} has ${rules.length} rules; Chrome MV3 static rulesets must stay at or below ${MAX_STATIC_RULES_PER_RULESET}.`
    );
  }
}

async function main() {
  const text = await fetchUrl(EASYLIST_URL);
  const { dnrRules, cosmeticRules } = parseRules(text);

  if (!writeChanges) {
    console.log(
      `[dry] parsed ${dnrRules.length} DNR rules and ${cosmeticRules.length} cosmetic rules from EasyList.`
    );
    console.log('Run `node scripts/update-lists.mjs --write` to update local generated lists.');
    return;
  }
  
  const dnrPath = path.join(root, 'rules', 'easylist_dnr.json');
  fs.writeFileSync(dnrPath, JSON.stringify(dnrRules, null, 2));
  
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
