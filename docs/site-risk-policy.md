# Site Risk Policy Contract

Status: design contract plus pure classifier scaffold. `src/site-policy.js`
and `scripts/test-site-policy.mjs` prove the precedence rules, and
`scripts/eval-live-sites.mjs` reports the selected tier/protocol. Runtime
blocking behavior is unchanged until protocol wiring is implemented.

## Diagnostic Job

**User**: a person browsing with Attention Redirector enabled.

**Situation**: the extension needs to decide how strongly to block or replace
ad/clutter surfaces on the current page without breaking important workflows.

**Decision enabled**: choose the allowed blocking protocol for the page:
disabled, protected-standard, protected-soft, standard, ad-heavy, or hostile.

**Baseline without this policy**: one global blocking posture plus ad hoc
domain/path exceptions.

**Non-goals**:

- Do not infer moral quality or trustworthiness of a website.
- Do not promise full adblocker parity.
- Do not let a synthetic tester score override page-safety evidence.
- Do not weaken working behavior on sensitive tools without proven breakage.
- Do not add per-site patchups without a matching eval and rollback point.

**Failure cost**:

- False positive: broken login, checkout, admin dashboard, productivity tool,
  or blank page.
- False negative: missed visible ads, clutter, trackers, or popups.
- Vague result: future changes become patch loops because nobody can tell
  which protocol was supposed to apply.

## Evidence Ontology

Use explicit evidence states. Do not present inferred category as measured fact.

- `given`: user setting, global off, current-site disabled, future per-site
  mode override.
- `observed`: URL, host, path, form/password/payment/login signals, visible
  page health, replacement count, suspicious frames, request hosts, popups.
- `derived`: normalized host, matched policy tier, selected protocol.
- `inferred`: page category such as news portal or hostile download page based
  on stable signals.
- `unknown`: no category evidence strong enough to escalate.
- `contradiction`: ad-heavy signals conflict with sensitive workflow signals.
- `test`: an eval case with expected tier, protocol, health, and replacement
  behavior.

## Tiers And Protocols

### Disabled

Source: user disabled the extension globally or for the current site.

Protocol:

- No DOM replacement.
- Static DNR rulesets disabled globally, or high-priority per-site DNR allow
  rules installed for the disabled domain.

### Protected

Examples: Google Ads, Google Ad Manager, accounts, Gmail, Docs, Drive, payment
flows, banking-like pages, checkout pages, password/account pages.

Protocol:

- `protected-standard` by default: keep the current baseline if it is working.
- Forbid ad-heavy or hostile escalation.
- Avoid broad DOM replacement on app/dashboard UI.
- Use `protected-soft` only after proven breakage.
- Never add special DNR allow rules only because a page is protected.

Google Ads note: current behavior appears usable. Therefore Google Ads should
not be softened preemptively. The protected tier exists to prevent future
aggressive rules from treating it like an ad-heavy publisher page.

### Sensitive

Examples: dashboards, admin panels, productivity apps, complex forms, editors,
logged-in SaaS tools.

Protocol:

- Baseline DNR may remain active if no breakage is observed.
- DOM replacement must be conservative and skip form/editor/navigation/app
  containers.
- Escalation requires explicit user override and a passing eval for that class
  of site.

### Standard

Examples: ordinary articles, blogs, search results, product pages, docs pages
without sensitive app flows.

Protocol:

- Current release behavior.
- Packaged DNR baseline.
- Cosmetic matching plus existing safety checks.
- Bounded DOM replacement only.

Unknown sites default here, not to aggressive or hostile behavior.

### Ad-Heavy

Examples: cluttered news portals, sports/entertainment sites, recipe pages,
tabloid sites, pages with repeated visible ad frames and known ad-source
children.

Protocol:

- Stronger cosmetic and DOM candidate eligibility may be allowed.
- Stronger DNR may be allowed only through a curated, eval-covered path.
- Page-health checks are required before a rule graduates.
- Normal content rails, nav, article bodies, forms, comments, and account
  widgets remain protected by hard safety skips.

### Hostile

Examples: popup-heavy streaming/download pages, fake button pages, redirect
traps, pages with takeover iframes.

Protocol:

- Aggressive cleanup can be allowed when evidence is high confidence or the
  user opts in.
- Stricter iframe, popup, and fixed-overlay handling is acceptable.
- False-positive tolerance is higher than standard pages, but blank-page and
  main-content destruction are still failures.

## Output Contract

The classifier should produce an inspectable object:

```json
{
  "tier": "protected",
  "protocol": "protected-standard",
  "confidence": "high",
  "evidence": [
    {
      "state": "observed",
      "signal": "host",
      "value": "ads.google.com",
      "effect": "protect from escalation"
    }
  ],
  "blockedEscalations": ["ad-heavy", "hostile"],
  "notes": ["baseline remains active unless breakage is proven"]
}
```

Do not use decimal confidence unless it is calibrated against eval outcomes.
Use `low`, `medium`, or `high` with evidence attached.

## Logic Substrate

Use a layered decision table plus small evidence helpers. Do not use a weighted
score for the page tier.

Reason:

- The critical decisions are finite and auditable.
- Precedence matters more than additive strength.
- Scores invite false precision and are easy to tune toward synthetic testers
  instead of real page safety.

## Precedence

1. Global disabled wins.
2. Current-site disabled wins.
3. Sensitive path or DOM workflow signals win over ad-heavy signals.
4. Protected domains win over aggressive/hostile escalation.
5. Known breakage or blank-page regression forces soft/disabled handling until
   fixed.
6. User explicit aggressive override can escalate standard/ad-heavy pages, but
   should not override banking, payment, password, checkout, or account flows.
7. Known ad-heavy domains can escalate only to ad-heavy, not hostile, unless
   hostile evidence is observed.
8. A single password field does not downgrade a known ad-heavy portal; local
   form safety skips protect the widget while the page can remain ad-heavy.
9. Unknown domains default to standard.

## Input Matrix

| Input | Evidence state | Changes behavior? | Unknown allowed? |
|---|---|---:|---:|
| Global enabled setting | given | yes | no |
| Disabled domain list | given | yes | no |
| Future per-site mode override | given | yes | yes |
| Host and normalized domain | observed/derived | yes | no |
| Path keywords: login, checkout, account, payment | observed | yes | yes |
| DOM workflow signals: password fields, payment forms, content editors, account forms | observed | yes | yes |
| Known protected domain list | derived | yes | yes |
| Known ad-heavy domain list | derived | yes | yes |
| Hostile page signals: popups, takeover iframes, fake download buttons | observed/inferred | yes | yes |
| Page-health result: blank, app error, low body text | observed/test | yes | no in eval |
| Replacement count and visible suspect count | observed/test | yes in eval | no in eval |

Delete any future input that cannot change protocol, evidence, or eval outcome.

## Smallest Eval Set

1. Google Ads or Ad Manager canary: expected protected-standard, baseline
   remains active, no aggressive escalation, no app breakage.
2. Gmail/Docs/Drive/accounts canary: expected protected or sensitive, no DOM
   replacement in app UI, DNR allow behavior remains consistent with current
   sensitive handling.
3. Normal article fixture: expected standard, obvious ad slots replaced, main
   content untouched.
4. `ukr.net` canary: expected ad-heavy, page must render, no white screen, no
   portal rail replacement, visible ad slots counted separately from page
   health.
5. Hostile-signal canary: a page reporting takeover iframes, popup tabs, or
   redirect traps is expected to classify hostile from those observed signals
   rather than from a shipped list of named sites; this is classifier-only
   until runtime wiring exists.
6. Near-neighbor false positive: a useful sidebar or portal rail containing one
   ad child must not promote the whole rail.

## Implementation Sequence

1. Add a pure classifier with deterministic tests. Done in
   `src/site-policy.js` and `scripts/test-site-policy.mjs`.
2. Keep runtime behavior unchanged while tests prove routing and precedence.
3. Add eval reporting that records tier, protocol, page health, cards, suspects,
   and blocked escalation reason. Done in `scripts/eval-live-sites.mjs`.
4. Run live-browser canaries for `risk-canary` and `controlled` groups.
5. Wire content-script scan thresholds to protocol.
6. Wire background DNR allow/escalation behavior to protocol.
7. Only then consider a separate aggressive ruleset or curated ad-heavy path.

## Failure Behavior

- If classification throws, use standard protocol and log no remote telemetry.
- If evidence conflicts, choose the less destructive protocol and expose the
  blocked escalation in diagnostics.
- If a page is blank or app-broken in eval, the case fails even if visible ads
  were removed.
- If a live site produces a miss, do not patch the live rule immediately.
  Convert it into an eval case or fixture first.

## Open Decisions

- Whether v1 needs user-visible per-site modes beyond current-site off.
- Whether hostile mode is opt-in only or can be automatic after enough eval
  coverage.
- Exact domain seed graduation rules after live eval reporting shows drift.
- Whether aggressive DNR should be a separate ruleset or dynamic session rules.
