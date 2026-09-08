import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';
const EASYLIST_RULESET_ID = 'easylist';

// Chrome guarantees this extension 30000 combined static rules. Session rules
// consume the same allowance, so leave 1000 slots for the per-site and per-tab
// allows installed by src/background.js. This deliberately duplicates the
// independent budget lint: the generator must produce a valid artifact, while
// the lint must catch the generator being wrong.
export const MAX_PACKAGED_STATIC_RULES = 29000;
const GENERATED_COSMETIC_RULE_LIMIT = 5000;
const writeChanges = process.argv.includes('--write');

const HOST_PREVALENCE = readScoreFixture('tests/fixtures/host-prevalence.json');
const OBSERVED_AD_HOSTS = readScoreFixture('tests/fixtures/observed-ad-hosts.json');
export const GENERATED_DNR_RULE_LIMIT = generatedDnrRuleLimit();

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

export function parseRules(text, options = {}) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!'));

  const parsedDnrRules = [];
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

    parsedDnrRules.push({ id: ruleId++, priority: 1, action: { type: 'block' }, condition });
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
    parsedDnrRules.push({ id: ruleId++, priority: 2, action: { type: 'allow' }, condition });
    exceptionCount += 1;
  }

  const selection = selectDnrRules(parsedDnrRules, {
    limit: options.ruleLimit ?? GENERATED_DNR_RULE_LIMIT,
    hostPrevalence: options.hostPrevalence ?? HOST_PREVALENCE,
    observedAdHosts: options.observedAdHosts ?? OBSERVED_AD_HOSTS
  });
  const dnrRules = selection.rules;
  const selectedExceptionCount = dnrRules.filter(rule => rule.action.type === 'allow').length;

  return {
    dnrRules,
    exceptionCount: selectedExceptionCount,
    parsedDnrRuleCount: parsedDnrRules.length,
    parsedExceptionCount: exceptionCount,
    selection: selection.stats,
    cosmeticRules: cosmeticRules.slice(0, GENERATED_COSMETIC_RULE_LIMIT)
  };
}

// Ranks complete dependency groups rather than individual rules. Every rule
// anchored to one request host travels together, so a block can never survive
// after an EasyList exception that narrows it has been dropped. Hostless rules
// are independent groups because no host-scoped exception can point at them.
//
// Known hosts rank by this project's observations first and web prevalence
// second. The long unmeasured tail is ordered by a stable hash, spreading the
// retained rules across the whole alphabet instead of recreating the old
// letter-b truncation under a different name.
export function selectDnrRules(
  rules,
  {
    limit,
    hostPrevalence = {},
    observedAdHosts = {}
  }
) {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`generated EasyList DNR limit must be a non-negative integer, got ${limit}.`);
  }

  const groups = new Map();
  for (const rule of rules) {
    const host = hostOfFilter(rule.condition?.urlFilter || '')?.toLowerCase() || null;
    const key = host
      ? `host:${host}`
      : `pattern:${JSON.stringify(rule.condition || {})}:${rule.action?.type || ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        host,
        rules: [],
        hasAllow: false,
        prevalence: 0,
        observations: 0
      });
    }
    const group = groups.get(key);
    group.rules.push(rule);
    group.hasAllow ||= rule.action?.type === 'allow';
  }

  const hostGroups = new Map(
    [...groups.values()].filter(group => group.host).map(group => [group.host, group])
  );
  applyHostScores(hostGroups, hostPrevalence, 'prevalence');
  applyHostScores(hostGroups, observedAdHosts, 'observations');

  const rankedGroups = [...groups.values()].sort(compareRankedGroups);
  const selectedKeys = new Set();
  let selectedCount = 0;

  for (const group of rankedGroups) {
    if (selectedCount + group.rules.length > limit) continue;
    selectedKeys.add(group.key);
    selectedCount += group.rules.length;
  }

  // Preserve upstream order for review stability, but replace the gapped ids
  // left by selection with one compact deterministic sequence.
  const selected = [];
  for (const rule of rules) {
    const host = hostOfFilter(rule.condition?.urlFilter || '')?.toLowerCase() || null;
    const key = host
      ? `host:${host}`
      : `pattern:${JSON.stringify(rule.condition || {})}:${rule.action?.type || ''}`;
    if (!selectedKeys.has(key)) continue;
    selected.push({ ...rule, id: 100 + selected.length });
  }

  if (selected.length > limit) {
    throw new Error(
      `generated EasyList DNR selection produced ${selected.length} rules for a ${limit}-rule budget.`
    );
  }

  const selectedGroups = rankedGroups.filter(group => selectedKeys.has(group.key));
  return {
    rules: selected,
    stats: {
      limit,
      sourceRules: rules.length,
      selectedRules: selected.length,
      droppedRules: rules.length - selected.length,
      sourceGroups: groups.size,
      selectedGroups: selectedGroups.length,
      prevalenceGroups: selectedGroups.filter(group => group.prevalence > 0).length,
      observedGroups: selectedGroups.filter(group => group.observations > 0).length,
      exceptionGroups: selectedGroups.filter(group => group.hasAllow).length,
      hostlessGroups: selectedGroups.filter(group => !group.host).length
    }
  };
}

function applyHostScores(hostGroups, scores, field) {
  for (const [rawHost, rawScore] of Object.entries(scores)) {
    const fixtureHost = rawHost.toLowerCase();
    const score = Number(rawScore);
    if (!Number.isFinite(score) || score < 0) {
      throw new Error(`invalid ${field} score for ${rawHost}: ${rawScore}.`);
    }

    const candidates = isIpv4Address(fixtureHost)
      ? [fixtureHost]
      : parentDomains(fixtureHost);
    for (const candidate of candidates) {
      const group = hostGroups.get(candidate);
      if (!group) continue;
      if (field === 'prevalence') {
        // Prevalence values are shares of sites and may overlap between a host
        // and its subdomains, so summing would double-count. The maximum is the
        // defensible lower-bound signal for a parent-domain block.
        group.prevalence = Math.max(group.prevalence, score);
      } else {
        // Observations are request-host counts from this project's own runs;
        // a parent-domain block catches every one of its observed subdomains.
        group.observations += score;
      }
    }
  }
}

function compareRankedGroups(a, b) {
  const aObserved = a.observations > 0 ? 1 : 0;
  const bObserved = b.observations > 0 ? 1 : 0;
  if (aObserved !== bObserved) return bObserved - aObserved;
  if (a.observations !== b.observations) return b.observations - a.observations;

  const aPrevalent = a.prevalence > 0 ? 1 : 0;
  const bPrevalent = b.prevalence > 0 ? 1 : 0;
  if (aPrevalent !== bPrevalent) return bPrevalent - aPrevalent;
  if (a.prevalence !== b.prevalence) return b.prevalence - a.prevalence;

  if (a.hasAllow !== b.hasAllow) return a.hasAllow ? -1 : 1;
  if (Boolean(a.host) !== Boolean(b.host)) return a.host ? 1 : -1;

  const hashDifference = stableHash(a.key) - stableHash(b.key);
  if (hashDifference !== 0) return hashDifference;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function parentDomains(host) {
  const labels = host.split('.');
  const parents = [];
  for (let index = 0; index < labels.length - 1; index += 1) {
    parents.push(labels.slice(index).join('.'));
  }
  return parents;
}

function isIpv4Address(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function readScoreFixture(relativePath) {
  const fixturePath = path.join(root, relativePath);
  const value = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${relativePath} must contain a host-to-score object.`);
  }
  return value;
}

function generatedDnrRuleLimit() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const resources = manifest.declarative_net_request?.rule_resources;
  if (!Array.isArray(resources)) {
    throw new Error('manifest.json declares no DNR rule resources.');
  }

  const generatedResource = resources.find(resource => resource.id === EASYLIST_RULESET_ID);
  if (!generatedResource) {
    throw new Error(`manifest.json must declare the ${EASYLIST_RULESET_ID} ruleset.`);
  }

  let otherPackagedRules = 0;
  for (const resource of resources) {
    if (resource.id === EASYLIST_RULESET_ID) continue;
    const rules = JSON.parse(fs.readFileSync(path.join(root, resource.path), 'utf8'));
    if (!Array.isArray(rules)) {
      throw new Error(`${resource.path} must contain a DNR rule array.`);
    }
    otherPackagedRules += rules.length;
  }

  const limit = MAX_PACKAGED_STATIC_RULES - otherPackagedRules;
  if (limit < 1) {
    throw new Error(
      `non-EasyList rules consume ${otherPackagedRules} of the ${MAX_PACKAGED_STATIC_RULES}-rule static budget.`
    );
  }
  return limit;
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

// EasyList exceptions exist to un-break sites. Some of them un-break a site by
// letting its ads through, and converting those into packaged `allow` rules
// means shipping rules whose whole effect is to permit advertising on named
// publishers. Reported privately 2026-08-31: 36 of the 138 shipped allow rules
// named an ad-delivery endpoint — GAMPAD on bloomberg.com, spiegel.de and
// wunderground.com, Amazon apstag on accuweather.com, adnxs on zone.msn.com.
// Chrome's own matcher confirmed the exception beat the block.
//
// Measured 2026-09-08 before removing any of them: a build with all 36 dropped
// was byte-identical to the shipped build on 10 of 12 named sites, while ad
// serving fell to zero on seven. The two apparent regressions were page
// variance and bot detection, both reproduced in the unmodified build.
const AD_DELIVERY_ENDPOINT_RE =
  /(doubleclick|googlesyndication|googleadservices|googletagservices|adservice|adsystem|amazon-adsystem|adnxs|criteo|rubiconproject|openx|pubmatic|taboola|outbrain|adsbygoogle|gampad|360yield)/i;

// Held back rather than endorsed. These are the video-ad SDK's own requests,
// and they are the one subset where "un-break" plausibly means the player will
// not start without an ad response. The 2026-09-08 measurement counted video
// elements but never got playback started in either build, so it proved nothing
// about them either way. Blocking a video ad at the cost of a player that hangs
// is a product decision that wants evidence first.
const VIDEO_AD_SDK_INITIATOR = "imasdk.googleapis.com";

// Hand-reviewed re-admits. Each entry needs a reason that is about page
// function rather than about advertising.
const FUNCTIONAL_EXCEPTIONS = [
  {
    urlFilter: "||amazon-adsystem.com/widgets/q?",
    why: "Affiliate widget product images, image resource type only. Serves the picture in an affiliate link rather than an impression, and it is unscoped, so dropping it would blank product images anywhere the widget is used."
  }
];

// Pure so it can be tested without the network and without regenerating.
// Returns null to keep the exception, or a string saying why it was refused.
export function refuseAdDeliveryException(condition) {
  if (!condition || !AD_DELIVERY_ENDPOINT_RE.test(condition.urlFilter || "")) {
    return null;
  }

  if (FUNCTIONAL_EXCEPTIONS.some((entry) => entry.urlFilter === condition.urlFilter)) {
    return null;
  }

  if ((condition.initiatorDomains || []).includes(VIDEO_AD_SDK_INITIATOR)) {
    return null;
  }

  return `exception targets an ad-delivery endpoint: ${condition.urlFilter}`;
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

  if (refuseAdDeliveryException(condition)) return null;

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

async function main() {
  const text = await fetchUrl(EASYLIST_URL);
  const {
    dnrRules,
    exceptionCount,
    parsedDnrRuleCount,
    parsedExceptionCount,
    selection,
    cosmeticRules
  } = parseRules(text);

  const mode = writeChanges ? 'write' : 'dry';
  console.log(
    `[${mode}] parsed ${parsedDnrRuleCount} DNR rules ` +
      `(${parsedDnrRuleCount - parsedExceptionCount} block, ${parsedExceptionCount} scoped allow); ` +
      `ranked and kept ${dnrRules.length} ` +
      `(${dnrRules.length - exceptionCount} block, ${exceptionCount} scoped allow) ` +
      `across ${selection.selectedGroups} dependency groups.`
  );
  console.log(
    `[${mode}] evidence kept: ${selection.observedGroups} observed-host groups, ` +
      `${selection.prevalenceGroups} prevalence-scored groups, ` +
      `${selection.hostlessGroups} hostless patterns; ${cosmeticRules.length} cosmetic rules parsed.`
  );

  if (!writeChanges) {
    console.log('Run `node scripts/update-lists.mjs --write` to update local generated lists.');
    return;
  }
  
  // Written minified: at ~29k rules the indented form still costs several MB
  // of package and repo weight for a file no human reviews line by line.
  // lint-dnr-rules.mjs is the review mechanism.
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
  '! Notes Not Ads seed rules plus a local cosmetic snapshot.',
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
