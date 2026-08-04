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

// EasyList option -> DNR resource type.
const TYPE_OPTIONS = {
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

const PARTY_OPTIONS = {
  'third-party': 'thirdParty',
  '3p': 'thirdParty',
  'first-party': 'firstParty',
  '1p': 'firstParty'
};

// Options that change nothing we can express. $important only decides who wins
// a block/allow tie, and ignoring it favours not blocking.
const NEUTRAL_OPTIONS = new Set(['important', 'match-case']);

// Any option outside the three sets above makes the rule unconvertible, and an
// unknown option is treated the same way. $popup has no DNR resource type;
// $document and $all block top-level navigation, which fails far more visibly
// than a missed ad; $rewrite and $redirect need actions this build refuses to
// ship; $generichide and friends belong to the cosmetic layer, not DNR.

// A pattern carrying no host anchor is evaluated against every request on every
// site, so it needs more than the four characters the curated list gets away
// with. Measured against EasyList: raising this from 6 to 8 costs 10 of 1173
// hostless rules and removes exactly the ones that can match an ordinary URL by
// coincidence — /e/cm?, /a/?ad=, ://adv. Raising it to 9 would cost 204.
const MIN_HOSTLESS_FILTER_CORE = 8;

// An allow rule with no initiator scope is only safe when its own pattern names
// a specific resource. This is the length required of the part after the host.
const MIN_ALLOW_DISCRIMINATOR = 4;

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

  const seenConditions = new Set();

  for (const line of lines) {
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#')) {
      cosmeticRules.push(line);
      continue;
    }
    if (line.startsWith('@@')) continue;

    const condition = parseBlock(line);
    if (!condition) continue;

    const key = JSON.stringify(condition);
    if (seenConditions.has(key)) continue;
    seenConditions.add(key);

    const host = hostOfFilter(condition.urlFilter);
    if (host) blockedDomains.add(host);

    dnrRules.push({ id: ruleId++, priority: 1, action: { type: 'block' }, condition });
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
    const key = `allow:${JSON.stringify(condition)}`;
    if (seenConditions.has(key)) continue;
    seenConditions.add(key);
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

// Splits "pattern$opt1,opt2" apart. EasyList only ever puts options after the
// last $ on a line, and an option list never contains a slash or a space, so a
// trailing $ inside a path or a $csp value is not mistaken for a separator.
function splitOptions(line) {
  const index = line.lastIndexOf('$');
  if (index < 0) return { pattern: line, options: [] };
  const tail = line.slice(index + 1);
  if (/[\s/]/.test(tail)) return { pattern: line, options: [] };
  return { pattern: line.slice(0, index), options: tail.split(',').filter(Boolean) };
}

// Reads the option list shared by block and exception lines. Returns null on
// anything it does not understand, so an unrecognised option drops the rule
// instead of silently shipping a wider match than the list author wrote.
function parseOptions(options) {
  const parsed = {
    resourceTypes: [],
    initiatorDomains: null,
    excludedInitiatorDomains: null,
    domainType: null
  };

  for (const option of options) {
    const negated = option.startsWith('~');
    const bare = negated ? option.slice(1) : option;

    if (bare.startsWith('domain=')) {
      const included = [];
      const excluded = [];
      for (const value of bare.slice(7).split('|')) {
        if (!value) continue;
        const domain = value.replace(/^~/, '').toLowerCase();
        if (!/^[a-z0-9.\-]+$/.test(domain)) return null;
        (value.startsWith('~') ? excluded : included).push(domain);
      }
      if (included.length) parsed.initiatorDomains = included;
      if (excluded.length) parsed.excludedInitiatorDomains = excluded;
      continue;
    }

    if (PARTY_OPTIONS[bare]) {
      const party = PARTY_OPTIONS[bare];
      const resolved = negated
        ? (party === 'thirdParty' ? 'firstParty' : 'thirdParty')
        : party;
      if (parsed.domainType && parsed.domainType !== resolved) return null;
      parsed.domainType = resolved;
      continue;
    }

    if (TYPE_OPTIONS[bare]) {
      // A negated type means "every type except this one". Spelling out the
      // complement would widen the rule past what the author wrote.
      if (negated) return null;
      parsed.resourceTypes.push(TYPE_OPTIONS[bare]);
      continue;
    }

    if (NEUTRAL_OPTIONS.has(bare)) continue;
    return null;
  }

  return parsed;
}

// Normalises an EasyList pattern into a DNR urlFilter, or null when the pattern
// has no safe DNR equivalent.
function toUrlFilter(pattern) {
  if (!pattern) return null;
  // Regex literals are rejected outright: their breadth cannot be judged from
  // their length, which is the whole basis of the specificity guards below.
  // This must stay above the wildcard strip. EasyList writes a path rule as
  // /ad/img/* and a regex as /ad\/img/, so the trailing wildcard is the only
  // thing telling them apart — strip it first and 180 path rules start looking
  // like regexes.
  if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) return null;
  if (!/^[\x21-\x7e]+$/.test(pattern)) return null;
  if (pattern.includes('$')) return null;

  // Leading and trailing wildcards are what DNR does by default.
  const filter = pattern.replace(/^\*+/, '').replace(/\*+$/, '');
  if (!filter) return null;

  const core = filter.replace(/[|^*]/g, '');
  if (filter.startsWith('||')) {
    return core.length >= 4 ? filter : null;
  }
  return core.length >= MIN_HOSTLESS_FILTER_CORE ? filter : null;
}

function hostOfFilter(urlFilter) {
  if (!urlFilter.startsWith('||')) return null;
  const host = urlFilter.slice(2).split(/[/^*?]/)[0];
  return host || null;
}

// Returns a DNR condition for a blocking line, or null when it cannot be
// expressed. Bare-host lines gain back the trailing ^ EasyList wrote: without
// the separator, ||adnxs.com also matches adnxs.community.example.org.
export function parseBlock(line) {
  const { pattern, options } = splitOptions(line);
  const parsed = parseOptions(options);
  if (!parsed) return null;

  const bareHost = /^\|\|[^/^*|]+\^?$/.test(pattern);
  const urlFilter = toUrlFilter(bareHost ? `||${pattern.slice(2).replace(/\^$/, '')}^` : pattern);
  if (!urlFilter) return null;

  const condition = { urlFilter };
  condition.resourceTypes = parsed.resourceTypes.length
    ? parsed.resourceTypes
    : [...BLOCK_RESOURCE_TYPES];
  if (parsed.initiatorDomains) condition.initiatorDomains = parsed.initiatorDomains;
  if (parsed.excludedInitiatorDomains) {
    condition.excludedInitiatorDomains = parsed.excludedInitiatorDomains;
  }
  if (parsed.domainType) condition.domainType = parsed.domainType;
  return condition;
}

// Returns a DNR condition for an @@ exception, or null when the exception
// cannot be expressed safely. An allow rule must be scoped by initiator or by
// its own pattern; an unscoped one would unblock a tracker on every site.
export function parseException(line, blockedDomains) {
  const { pattern, options } = splitOptions(line.slice(2));
  const parsed = parseOptions(options);
  if (!parsed) return null;

  // "Allow everywhere except here" has no safe scoped form.
  if (parsed.excludedInitiatorDomains) return null;

  const urlFilter = toUrlFilter(pattern);
  if (!urlFilter) return null;

  const host = hostOfFilter(urlFilter);
  // An exception only earns a rule when it carves out something we block.
  if (!host || !blockedDomains.has(host)) return null;

  if (!parsed.initiatorDomains?.length && !isSelfScopedAllow(urlFilter)) return null;

  const condition = { urlFilter };
  if (parsed.initiatorDomains) condition.initiatorDomains = parsed.initiatorDomains;
  if (parsed.resourceTypes.length) condition.resourceTypes = parsed.resourceTypes;
  if (parsed.domainType) condition.domainType = parsed.domainType;
  return condition;
}

// A host-anchored allow carries its own scope once it names a path or query
// beyond the host, because it can then only ever match that one resource.
export function isSelfScopedAllow(urlFilter) {
  if (!urlFilter.startsWith('||')) return false;
  const rest = urlFilter.slice(2);
  const separator = rest.search(/[/^]/);
  if (separator < 0) return false;
  const discriminator = rest.slice(separator + 1).replace(/[|^*]/g, '');
  return discriminator.length >= MIN_ALLOW_DISCRIMINATOR;
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
