import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GENERATED_DNR_RULE_LIMIT,
  MAX_PACKAGED_STATIC_RULES,
  parseRules,
  selectDnrRules
} from './update-lists.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function block(id, urlFilter) {
  return {
    id,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter, resourceTypes: ['script'] }
  };
}

function allow(id, urlFilter, initiatorDomains = ['publisher.example']) {
  return {
    id,
    priority: 2,
    action: { type: 'allow' },
    condition: { urlFilter, initiatorDomains }
  };
}

function filters(rules) {
  return rules.map(rule => `${rule.action.type}:${rule.condition.urlFilter}`).sort();
}

const seedRules = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'rules/rules_1.json'), 'utf8')
);
assert.equal(
  GENERATED_DNR_RULE_LIMIT + seedRules.length,
  MAX_PACKAGED_STATIC_RULES,
  'the generated allowance must follow the actual packaged seed count'
);

const prevalence = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'tests/fixtures/host-prevalence.json'), 'utf8')
);
const observations = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'tests/fixtures/observed-ad-hosts.json'), 'utf8')
);
assert.equal(Object.keys(prevalence).length, 2312, 'host-prevalence fixture size');
assert.equal(Object.keys(observations).length, 154, 'observed-ad-host fixture size');
assert.equal(
  Object.values(observations).reduce((total, count) => total + count, 0),
  3364,
  'observed request count'
);

// A host seen by this project's own evals wins a tight budget, including when
// the observations name subdomains caught by a parent-domain rule.
{
  const source = [
    block(1, '||unmeasured.example^'),
    block(2, '||tracker.example^')
  ];
  const selected = selectDnrRules(source, {
    limit: 1,
    observedAdHosts: { 'ads.tracker.example': 3 }
  }).rules;
  assert.deepEqual(filters(selected), ['block:||tracker.example^']);
}

// Broader web prevalence ranks measured hosts ahead of the unmeasured tail.
{
  const source = [
    block(1, '||unmeasured.example^'),
    block(2, '||common.example^')
  ];
  const selected = selectDnrRules(source, {
    limit: 1,
    hostPrevalence: { 'cdn.common.example': 0.12 }
  }).rules;
  assert.deepEqual(filters(selected), ['block:||common.example^']);
}

// The safety invariant: a host's block and every exception travel as one
// dependency group. If the whole group does not fit, the block is dropped too.
{
  const pair = [
    block(1, '||video-ads.example^'),
    allow(2, '||video-ads.example^')
  ];
  const source = [...pair, block(3, '||other.example^')];
  const tooTight = selectDnrRules(source, { limit: 1 }).rules;
  assert.deepEqual(filters(tooTight), ['block:||other.example^']);

  const enough = selectDnrRules(source, { limit: 2 }).rules;
  assert.deepEqual(filters(enough), filters(pair));
}

// Hostless paths survive hostname rotation, so the safe patterns accepted by
// the parser rank ahead of an entirely unmeasured host when only one fits.
{
  const source = [
    block(1, '||unmeasured.example^'),
    block(2, '/wp-content/plugins/ad-inserter/')
  ];
  const selected = selectDnrRules(source, { limit: 1 }).rules;
  assert.deepEqual(filters(selected), ['block:/wp-content/plugins/ad-inserter/']);
}

// The unmeasured tail is a deterministic spread, not source-order truncation.
// Reversing an alphabetically sorted input must retain exactly the same hosts,
// and the retained half must reach both sides of the alphabet.
{
  const source = 'abcdefghijklmnopqrstuvwxyz'.split('').map((letter, index) => {
    return block(index + 1, `||${letter}ads.example^`);
  });
  const forward = selectDnrRules(source, { limit: 13 }).rules;
  const reverse = selectDnrRules([...source].reverse(), { limit: 13 }).rules;
  assert.deepEqual(filters(forward), filters(reverse));

  const retainedLetters = forward.map(rule => rule.condition.urlFilter[2]);
  assert(retainedLetters.some(letter => letter < 'n'), 'spread must retain an early-letter host');
  assert(retainedLetters.some(letter => letter >= 'n'), 'spread must retain a late-letter host');
  assert.deepEqual(
    forward.map(rule => rule.id),
    Array.from({ length: 13 }, (_, index) => 100 + index),
    'selected rules receive compact deterministic ids'
  );
}

// Exercise the parser boundary too: the selection pass sees exceptions parsed
// in pass two and refuses to strand their matching block.
{
  const sample = [
    '||video-ads.example^',
    '||other.example^',
    '@@||video-ads.example^$domain=publisher.example'
  ].join('\n');
  const parsed = parseRules(sample, {
    ruleLimit: 1,
    hostPrevalence: {},
    observedAdHosts: {}
  });
  assert.deepEqual(filters(parsed.dnrRules), ['block:||other.example^']);
  assert.equal(parsed.parsedExceptionCount, 1);
  assert.equal(parsed.exceptionCount, 0);
}

console.log('PASS EasyList ranked-selection tests');
