# DECISIONS

## 2026-06-02 - Start With DOM-Level Visual Blocking

**Decision**: Implement "blocking" in the MVP as conservative DOM replacement of likely ad/clutter containers, not a uBlock-style network blocking engine.

**Why**: The product overlaps with ad blockers, but its unique value is turning wasted attention space into user-owned reminders, notes, and learning cards. Network blocking, filter lists, and request interception would increase scope and put the project in direct competition with mature ad blockers before the product value is proven.

**Consequences**:
- The extension can still visually remove many obvious ad slots.
- Some ads will be missed.
- No remote lists or analytics are needed.
- Future network blocking remains possible after dogfooding proves the card experience is useful.

## 2026-06-02 - Keep The MVP Vanilla

**Decision**: Use plain Manifest V3, HTML, CSS, and JavaScript with no build tool or dependencies.

**Why**: The first version needs to be readable, auditable, and easy to load unpacked. A framework would add maintenance before the product proof.

**Consequences**:
- Files can be loaded directly by Chrome.
- UI complexity stays modest.
- Shared settings helpers are duplicated lightly between popup/options/content scripts instead of introducing a bundler.

## 2026-06-02 - Add Local Inspector Before Aggressive Blocking

**Decision**: Add a page-local clutter inspector that highlights broader suspects and copies diagnostic reports before making normal replacement selectors more aggressive.

**Why**: Persistent animated rectangles and popups need more context than tag names. Reports capture size, position, z-index, source URLs, text, and safety blocks so selector tuning can be based on repeated patterns instead of guesses.

**Consequences**:
- Normal replacement remains conservative.
- Popup-like and animated elements can be studied without automatically blocking real site UI.
- No remote logging, analytics, or clipboard permission is needed.

## 2026-06-02 - Add Scripting Permission For Popup Fallback

**Decision**: Add Chrome's `scripting` permission so the popup can inject the existing content script and stylesheet into the active tab when `chrome.tabs.sendMessage` finds no listener.

**Why**: Tabs opened before an extension load/update do not always have the content script attached. Without a fallback, popup actions like **Inspect clutter** can fail with "receiving end does not exist" until the user refreshes the page.

**Consequences**:
- Popup actions work more reliably on already-open tabs.
- The permission is used only after the user opens the popup and only for the active tab.
- This does not add network blocking, remote code, analytics, or filter-list behavior.

## 2026-06-02 - Add Playwright Browser Smoke Harness

**Decision**: Add `@playwright/test`, a local clutter fixture page, and `scripts/test-extension.mjs` to launch Chromium with the unpacked extension and verify inspector rendering.

**Why**: Chrome extension behavior cannot be debugged reliably from static code inspection. The inspector failure needed a real browser loop to distinguish popup wiring, content-script loading, and page-rendering issues.

**Consequences**:
- Browser tests now require Node dependencies and a local Chromium launch.
- The harness can catch content-script listener races and future selector regressions.
- The fixture should grow only from repeated real-world missed patterns.

## 2026-06-02 - Register Content Message Listener Before Storage Load

**Decision**: Register the content script's `chrome.runtime.onMessage` listener synchronously before awaiting `chrome.storage.local.get`.

**Why**: The popup could send `AR_TOGGLE_INSPECTOR` before the content script finished loading settings, producing `Receiving end does not exist`.

**Consequences**:
- Popup messages can be received immediately after the content script starts.
- Settings still load before normal automatic replacement.
- The Playwright smoke now verifies this path.

## 2026-06-02 - Use Replace All As Dogfood Default

**Decision**: Change the default/reset replacement frequency from `max3` to `all`.

**Why**: A page-level cap makes selector testing ambiguous. Later ads can look like missed selectors when the extension simply stopped replacing after the cap.

**Consequences**:
- Dogfood sessions give a cleaner read on true misses.
- Users can still choose `max1` or `max3` in Options for normal browsing.
- Existing installed storage may keep `max3` until reset or manually changed.

## 2026-06-02 - Save Inspector Reports Locally

**Decision**: Change inspector reporting to `Save + copy` for a selected missed element, with local saved-report export and clear controls.

**Why**: Manual notes per obvious banner create unnecessary friction. The inspector already knows the page, element, size, CSS, sources, reasons, and safety blocks.

**Consequences**:
- Hlib can click a missed banner and save/copy the report in one action.
- Reports stay in `chrome.storage.local`, capped at 75 recent records.
- No remote logging or new permission is needed.

## 2026-06-02 - Select Inspector Targets Via Extension Labels

**Decision**: Make the small inspector labels clickable selection handles while transparent outlines remain non-interactive.

**Why**: Clicking the underlying banner can activate ad links or iframes before the inspector captures the target. Extension-owned labels avoid sending the click to the page.

**Consequences**:
- Selection is safer on linked ads and iframes.
- Users should click the dark label attached to a highlight, not the ad creative itself.
- The browser smoke verifies label selection and saved-report creation.

## 2026-06-02 - Only Visible Password Fields Mark Pages Sensitive

**Decision**: Treat visible password inputs as sensitive, but ignore hidden password inputs when deciding whether the whole page should be skipped.

**Why**: Content sites can include hidden login modals in the DOM. Skipping the whole page for a hidden password input blocks normal ad/clutter inspection on otherwise safe pages.

**Consequences**:
- Login/security pages and visible password forms still skip.
- Hidden login widgets no longer block inspector mode.
- The browser fixture includes a hidden password field to cover this case.

## 2026-06-02 - Add Manual Pick For Unhighlighted Suspects

**Decision**: Add inspector manual-pick mode and a Use parent control.

**Why**: Auto-highlighted suspects are only heuristic guesses. Real pages contain ad containers that do not match early scoring rules, and Hlib needs to capture those without opening ad links.

**Consequences**:
- Hlib can select unhighlighted clutter by turning on Manual pick, hovering, and clicking the area.
- Use parent can widen from a child creative to its container.
- Browser smoke verifies manual selection on an unhighlighted fixture rectangle.

## 2026-06-02 - Let Strong Ad Signals Override Soft Unsafe Words

**Decision**: Allow obvious ad slots to pass normal replacement even when their identifiers contain layout words like `footer`.

**Why**: Real ad stacks such as AdThrive use IDs/classes like `AdThrive_Footer_1` and `google_ads_iframe...`. The previous unsafe-identifier rule treated `footer` as a hard block, so clear ad iframes were skipped.

**Consequences**:
- AdThrive/footer-style ad slots can now be replaced.
- Structural safety still blocks forms, article ancestors, nav/header/footer elements, visible password pages, and checkout/login contexts.
- Browser fixture now covers an AdThrive footer iframe.

## 2026-06-02 - Manual Pick Uses Capture Layer

**Decision**: Manual pick now uses an extension-owned full-page capture layer and coordinate lookup instead of relying on page click bubbling.

**Why**: Clicks inside ad iframes or linked ad creatives can navigate before the top-page inspector receives the event.

**Consequences**:
- Manual pick should not open ad links.
- The selected target is found from the pointer coordinates under the capture layer.
- Browser smoke verifies coordinate-based manual selection.

## 2026-06-03 - Promote Explicit Ad Children To Wrappers

**Decision**: When a candidate child is inside an obvious ad wrapper, promote replacement to the wrapper instead of replacing only the child.

**Why**: Real ads can render a large creative beside a smaller labeled/control child. Replacing only the child creates a broken sidecar where the ad remains visible next to an Attention Redirector card.

**Consequences**:
- Full ad units are more likely to be visually replaced as one slot.
- Explicit Google IMA-style video ad overlays can be replaced without replacing the whole article or video shell.
- Manual-pick ranking now penalizes broad generic ancestors unless they are explicit ad wrappers.
- Browser smoke covers partial ad wrapper replacement, IMA overlay replacement, and click-through manual pick without navigation.

## 2026-06-03 - Use Cosmetic Filter Compatibility As Next Detection Layer

**Decision**: The next serious detection upgrade should reuse public cosmetic-filter patterns instead of indefinitely expanding bespoke heuristics.

**Why**: Mature blockers get coverage from maintained filter ecosystems such as EasyList and uBlock-compatible cosmetic rules. Attention Redirector's differentiation is the replacement-card experience and safety layer, not inventing ad detection from scratch.

**Consequences**:
- Start with a conservative subset of EasyList/uBlock-style `##` CSS selectors.
- Keep network rules, scriptlets, HTML filters, and procedural cosmetic filters out of the next slice.
- Run every selector match through the existing safety/replacement pipeline.
- Inspector reports remain useful for safety tuning, wrapper selection, and missed-pattern diagnosis, but should not be the only source of detection coverage.

## 2026-06-03 - Add Seed Cosmetic Filter Parser

**Decision**: Add a dependency-free cosmetic filter parser for a conservative subset of EasyList/uBlock-style rules.

**Why**: Attention Redirector should not invent ad detection from scratch. Cosmetic element-hiding selectors map directly to this product's DOM replacement behavior and can improve coverage without adding network blocking or a full uBlock engine.

**Scope**:
- Supports generic and domain-scoped `##` CSS selectors.
- Supports simple selector exceptions with `#@#`.
- Skips procedural filters, scriptlets, style rules, HTML filters, and network rules.
- Ships only a tiny local seed rule set for common selectors and fixtures.

**Consequences**:
- Cosmetic matches are added to the normal candidate collection and report reasons.
- Every cosmetic match still goes through Attention Redirector safety checks before replacement.
- The popup fallback injection now loads `src/cosmetic-filters.js` before `src/content.js`.
- `npm run check` includes a parser/domain/exception smoke test.
- Full EasyList/uBlock-style systems remain a later layered bet if the MVP proves valuable: list updater, MV3 `declarativeNetRequest`, procedural cosmetic filters, scriptlets, and logger/debugger tooling.

## 2026-06-03 - Treat AdBlock Tester As A Roadmap Benchmark

**Decision**: Add `scripts/test-adblock-tester.mjs` as an optional live benchmark, not a required CI gate.

**Why**: `adblock-tester.com` exposes the exact split between current DOM/cosmetic replacement and full adblocker behavior. The total score includes script loading, script execution, and file loading checks that Attention Redirector intentionally does not block yet.

**Consequences**:
- The benchmark reports the tester score, Attention Redirector inserted-card count, visible card count, and failed/warning lines.
- A low total score should not automatically trigger bespoke DOM selector work.
- Visibility failures belong to the current/cosmetic layer.
- Script/file loading failures belong to future MV3 `declarativeNetRequest`, filter-list updater, or scriptlet work if the MVP earns that scope.

## 2026-06-03 - Let Explicit Ad Evidence Beat Misleading Identifier Safety

**Decision**: Allow explicit Google/safeframe/IMA ad slots to pass identifier-name safety blocks while keeping structural safety boundaries hard.

**Why**: Real ad stacks often contain words that can look unsafe in isolation, or sit under ancestors with misleading utility IDs. Yahoo-style `google_ads_iframe...` safeframes were being reported as obvious ad slots but blocked by `unsafe identifier`. DailyMail-style fixed video ads had IMA source evidence but no standard banner dimensions.

**Consequences**:
- Explicit ad slots can override hard identifier-name matches.
- Forms, navigation, contenteditable areas, structural article/header/footer roots, and sensitive pages remain protected.
- Fixed/sticky elements with ad-like source evidence can match as `ad-like source`.
- The scanner observes attribute changes and runs short warmup scans so late display toggles are less likely to leave `Would replace now: yes` slots visible.
- Browser smoke includes fixtures for Google iframe slots under misleading ancestors and fixed IMA-source overlays.

## 2026-06-03 - Guard Replaced Slots Against Ad Refresh

**Decision**: Install a small MutationObserver on each replaced slot to restore the Attention Redirector card if the page rewrites the slot's children.

**Why**: Some sites refresh display ads in-place. Tom's Guide could show an Attention Redirector card briefly, then replace the same container with a new ad creative that manual pick could not select reliably.

**Consequences**:
- Reused ad containers now self-heal when their child list is rewritten.
- The hide button still works because the guard does not restore hidden slots.
- This does not prevent a site from removing and recreating the entire parent container. That remains a future selector/list or network-blocking problem.
- Browser smoke includes a refreshing ad fixture that rewrites an already-replaced slot and verifies the card is restored.

## 2026-06-03 - Add Hybrid Live-Site Eval Harness

**Decision**: Add a live-site eval runner with real ad-heavy pages and controlled adblock test pages.

**Why**: Manual testing found the important early bugs, but repeated broad testing should now be automated. The useful eval substrate is hybrid: deterministic fixture smoke for known regressions, plus real-world URL benchmarks for coverage trends. A human still needs to judge false positives and native/commerce policy.

**Consequences**:
- `evals/live-sites.json` stores the URL case list.
- `scripts/eval-live-sites.mjs` opens Chromium with the unpacked extension, scrolls pages, collects card counts and remaining visible ad-like suspects, and writes reports under `runs/live-site-evals/`.
- Runner supports `--dry-run`, `--group`, `--case`, `--limit`, timing controls, and optional `--fail-on-suspects`.
- Live eval failures should be triaged by type: load/setup error, visible ad suspect, false positive, or out-of-scope network/script blocking.

## 2026-06-03 - Treat Banner-Sized Script Iframes As Ad Slots

**Decision**: Treat size-constrained iframes with `javascript:` / `document.write(script)` source payloads as ad-slot candidates.

**Why**: Some sites use script-injected iframes for banner-like ad placements. A canary-portal report showed a `600x200` iframe inside article layout with a `javascript:void(...document.write(script)...)` payload, no accessible text, and no standard ad-network URL.

**Consequences**:
- The rule is restricted to iframe sources with script/document-write patterns and banner-like dimensions.
- Soft article/header/footer ancestry can be overridden by this explicit ad evidence.
- Large video players or normal embedded tools should remain outside this rule.
- Browser smoke includes a script-injected iframe fixture inside article context.

## 2026-06-05 - Use Ambient Field As The Primary Visual System

**Decision**: Make Ambient Field the primary replacement-card direction for both Quiet and Anchor. Keep Editorial Folio as a secondary Anchor text treatment.

**Why**: Ambient Field turns removed ad space into atmosphere without replacing one demand for attention with another. Editorial Folio gives user-written intentions more weight when desired, but its framing is too semantically active for Quiet mode.

**Consequences**:
- Quiet uses Ambient visuals without text.
- Anchor uses Ambient visuals with either Ambient or Editorial typography.
- Generic motivation, quotes, and feed-like content remain outside the initial product.
- Motion must stay slow, continuous, and low contrast, with no particles, abrupt loops, synchronized pulsing, or interaction bait.
- `prefers-reduced-motion` must produce a static treatment.
- Start with CSS-driven fields and gradients. Canvas/WebGL or more computational generative visuals should only be added if CSS cannot deliver the desired quality and browser dogfood shows acceptable performance.

## 2026-06-12 - Replace Explicit Full-Page Branding Takeovers

**Decision**: Treat near-viewport fixed `brnd` / `ibrnd` wrappers containing an
`/iframeHS/` iframe as explicit ad takeovers that may bypass the normal large
element cap.

**Why**: canary-portal used a cross-origin full-page betting skin from
`s.schulist.link` behind the site content. The iframe occupied the viewport and
opened a Beton registration popup on click, but generic identifier-based evals
reported no suspect because the wrapper and source were obfuscated.

**Consequences**:
- The exception requires viewport geometry, fixed positioning, the observed
  randomized branding identifier shape, and the `iframeHS` source path.
- Arbitrary full-page iframes, video players, and embedded apps remain blocked
  by the existing safety cap.
- The fixture and browser smoke cover takeover replacement.
- `scripts/diagnose-live-miss.mjs` captures screenshots, frames, fixed
  overlays, popup tabs, and third-party request hosts for future supplied
  misses.

## 2026-06-12 - Replace Dynamic Ads On The Leading Mutation Edge

**Decision**: Inject the content script at `document_end`, start observing
before asynchronous settings load completes, and schedule mutation scans against
the earliest pending deadline with an 80 ms delay.

**Why**: The previous `document_idle` injection plus restartable 900 ms debounce
made dynamic ads visibly render for about a second before replacement. Busy
pages could postpone the scan repeatedly because each mutation restarted the
timer.

**Consequences**:
- Stored settings still gate all scans; the early observer cannot replace
  anything until settings are loaded.
- Static DOM slots can be found before their image/iframe content finishes
  loading.
- Dynamic slots are normally evaluated about 80 ms after insertion, and later
  mutations cannot postpone an earlier scheduled scan.
- A timed browser fixture guards the latency. The measured result improved from
  about 1,144 ms to 83 ms in Chromium.
- This reduces visible flash but does not stop ad requests or script execution.
  Truly pre-render blocking remains a future `declarativeNetRequest` or
  equivalent network-layer decision.

## 2026-06-12 - Select Tide As The Production Ambient System

**Decision**: Use Tide as the sole production Ambient motion system for Quiet
and Anchor.

**Why**: Side-by-side review found Tide cleaner and less attention-demanding
than Breath or Lumen while still making replaced space feel intentional.

**Consequences**:
- Production cards no longer rotate through motion variants.
- Breath and Lumen remain only in the throwaway comparison prototype as design
  history.
- The browser smoke asserts that every production card uses Tide.
- Product interface work can proceed without exposing motion-style
  customization.

## 2026-06-12 - Use Visual Presence Instead Of Page Replacement Caps

**Decision**: Make the popup the everyday control surface and use a single
`Visual presence` scale from `0 · Clean` to `10 · Full Ambient`. Move global
defaults, disabled sites, and motion behavior to Options. Keep inspection under
Advanced and retire categories, preset content, and per-page frequency caps.

**Why**: The product is now about changing how much attention surface remains,
not choosing card content or limiting an arbitrary number of replacements. A
surface-based control maps directly to the user's desired outcome and keeps
Quiet and Anchor coherent with Tide.

**Consequences**:
- `0` hides/collapses every detected surface. This is DOM-level visual removal,
  not network request blocking.
- `1–9` uses a stable surface hash so the selected share becomes Tide and the
  remainder stays hidden across rescans.
- `10` renders Tide for every detected surface.
- Quiet renders Tide without text; Anchor renders one user-written intention.
- The popup owns global state, current-site state, mode, Anchor note, Visual
  presence, rescan, and Advanced inspection.
- Options owns the same global defaults plus motion and disabled-domain
  management.
- Legacy `customNotes` and `frequency` settings migrate to Anchor/Quiet and
  approximate presence values.

## 2026-06-12 - Preserve Framework-Owned Container DOM

**Decision**: For container candidates, keep site-owned child nodes in place
and render Tide as an extension-owned overlay. Hide the original subtree
visually and disable its pointer interaction without deleting it. Continue to
use a wrapper for direct replaced elements such as iframes and images.

**Why**: Forbes' React/Next client later tried to remove an ad child that
Attention Redirector had already deleted. React threw `NotFoundError` and
replaced the page with a client-side exception screen.

**Consequences**:
- Framework reconciliation can continue against the nodes it created.
- The replacement guard restores extension classes and the Tide child if a
  framework rewrites the container class or refreshes its children.
- Ad descendants remain in the DOM and may continue loading, consistent with
  the product's DOM-level rather than network-blocking scope.
- Browser smoke simulates a framework class rewrite and later child removal.

## 2026-06-12 - Require Healthy Pages Before Counting Live Eval Coverage

**Decision**: Classify HTTP failures, known rendered error titles, and empty
readable bodies as live-eval errors. Exclude those cases from card and suspect
totals. Ignore extension replacement descendants and their broad ancestors
when collecting residual suspect signals.

**Why**: The first full run falsely called a Forbes client exception and an
empty MSN render successful `0 cards / 0 suspects` cases. Preserved hidden ad
subtrees also contaminated ancestor suspect counts.

**Consequences**:
- A navigation can complete successfully and still fail page-health validity.
- The runner exits non-zero when any case renders an invalid page.
- `scripts/live-eval-health.mjs` keeps the validity rule deterministic and
  independently tested.
- Residual suspect counts remain trend signals, but handled replacement
  ancestry no longer inflates them.

## 2026-06-13 - Remove Runtime Blur And Gate Tide Motion Near The Viewport

**Decision**: Replace animated `filter: blur()` layers with intrinsically soft
linear/radial gradients. Use one `IntersectionObserver` to disable pseudo-
element animation outside a 700 px viewport margin, and ignore extension-owned
class mutations in the global page scanner.

**Why**: A 60-card scroll benchmark measured animated Tide at 75.2 ms p95 with
about 152 frames over 32 ms, while still Tide held 16.8 ms p95 with zero long
frames. Pausing or removing only offscreen animation did not fix the jank.
Removing runtime blur did.

**Consequences**:
- Tide keeps the selected visual direction without per-frame blur
  rasterization.
- Motion starts before a card enters view and is removed completely when far
  offscreen.
- Motion lifecycle class changes do not trigger full-page detection scans.
- An 80-card, two-run, 12-second stress benchmark holds 16.8 ms p95 and zero
  frames over 32 ms for animated Tide.
- Animated main-thread utilization measured 6.4%, versus 3.1% still and 2.2%
  disabled on the same machine.
- `npm run benchmark:performance` is the reusable local comparison loop.

## 2026-06-13 - Treat Schulist Media As Ad-Source Evidence

**Decision**: Add the exact `schulist.link` host to known ad-source evidence.
Keep all existing geometry, visibility, context, and safety requirements.

**Why**: uafix.net injected an identifier-free bottom banner with fixed
positioning, viewport width, z-index `2147483646`, and a child image from
`s.schulist.link/media/...`. Inspector reported no safety blocks, but production
detection had no match reason because the source host was unknown.

**Consequences**:
- Fixed Schulist media banners can match the existing `ad-like source` rule.
- Normal fixed headers and site controls remain untouched because they lack
  Schulist source evidence.
- The deterministic fixture mirrors the full-width fixed banner and verifies
  its image is visually and interactively suppressed.
- The existing `/iframeHS/` full-page branding takeover rule remains separate.

## 2026-06-18 - Productize DNR As A Bounded Release Layer

**Decision**: Keep MV3 `declarativeNetRequest` active for the release
candidate, but bound it with the same user/safety contract as DOM replacement:
global off disables static rulesets, disabled domains get high-priority session
`allow` rules, known sensitive domains get high-priority session `allow` rules,
and path-sensitive pages can request tab-scoped `allow` rules from the content
script.

**Why**: The product is moving beyond the original visual-only MVP toward a
usable public extension. Network blocking improves real-world usefulness and
reduces ad flash, but a global static ruleset can break checkout, login,
banking-like, or user-disabled pages if it does not respect the same boundaries
as the visual layer.

**Consequences**:
- `manifest.json` includes the DNR permission and packaged static rulesets.
- `src/background.js` owns DNR ruleset toggling plus domain/tab allow rules.
- `src/main.js` reports skipped/sensitive pages to the background worker so
  path-sensitive tabs can stop network blocking.
- `scripts/test-release-contract.mjs` fails if DNR or allow-rule behavior is
  accidentally removed from the release runtime.
- `scripts/test-extension.mjs` includes deterministic local DNR probes for
  enabled blocking, disabled-site allow, global-off allow, and sensitive-path
  tab allow.
- The EasyList DNR snapshot remains a mechanical coverage layer, not a mature
  uBlock-equivalent filter ecosystem. Improving its rule selection is future
  work.

## 2026-06-18 - Add Curated DNR Seeds For Release Benchmark Parity

**Decision**: Add hand-curated DNR seed rules for high-signal analytics,
error-monitoring, and banner-test resources: Google Analytics/Tag Manager,
Hotjar, Sentry, Bugsnag, the Bugsnag CloudFront script used by the benchmark,
and advertising banner asset paths.

**Why**: The generated EasyList slice missed several common resources because
it mechanically took early simple hostname rules instead of ranking rules by
real-world usefulness. `adblock-tester.com` scored 57/100, below the target
needed to be credible against the user's current blocker. The missing checks
were not obscure: Google Analytics, Hotjar, Sentry, Bugsnag, and same-origin
banner assets.

**Consequences**:
- `npm run test:adblock-tester` now enforces a default minimum score of 80/100.
- The current adblock-tester score is 97/100, with only Flash banner visibility
  still warning.
- Controlled live eval suspect signals on adblock-tester dropped materially.
- These rules block trackers/error-monitoring services that some sites may use
  for diagnostics; disabled-domain and sensitive-page allow rules remain the
  release safety valve.

## 2026-06-18 - Use Controlled Testers To Curate A Bounded DNR Baseline

**Decision**: Extract repeat misses from AdBlock Tester, GetBlockify, Turtlecute, and Canyoublockit into a hand-curated DNR seed layer, while keeping DNR subordinate to user disable and sensitive-page allow behavior.

**Why**: The extension needs credible release-grade network coverage, but copying every synthetic tester endpoint would create brittle score-chasing and page-break risk. The useful baseline is common blocker primitives: ad-serving domains, audio/video ad endpoints, mobile ad SDKs, analytics/session replay, social pixels, DMP trackers, and OEM telemetry.

**Consequences**:
- `rules/rules_1.json` now contains a larger curated baseline in addition to the generated EasyList snapshot.
- `scripts/diagnose-controlled-testers.mjs` is the exploratory harness for future baseline extraction and can run one case with `--case`.
- `scripts/test-release-contract.mjs` asserts representative curated DNR and Turtlecute cosmetic seeds remain packaged.
- Risky or legitimate-service endpoints such as Yandex maps are not blocked merely to improve a synthetic score.
- The next scale step should be a curated EasyPrivacy pipeline, not indefinite manual domain accretion.

## 2026-06-19 - Telemetry Strategy: Launch at Zero, Opt-In Later

**Decision**: The v1 launch of Attention Redirector will contain **zero** data collection or telemetry. All user settings, notes, and operations remain strictly local (`chrome.storage.local`). Telemetry may be introduced in a future (v1.x) update, but it must be explicitly user-triggered (e.g., a "Report broken site" button) and fully anonymized.

**Why**: The extension uses broad host access so it can inspect normal webpages and apply static network blocking. Chrome Web Store review guidance says broad host permissions and powerful capabilities can increase review scrutiny and time. Including remote logging, metrics, or telemetry in v1 would add privacy surface and review complexity. Launching at zero developer data collection builds immediate user trust and keeps the review story simple, though it does not guarantee review speed or approval.

**Consequences**:
- No external APIs or analytic scripts (e.g., Google Analytics, Sentry, Mixpanel) will be bundled in the extension payload.
- We rely strictly on Chrome Web Store console crash reports and user feedback (reviews/emails) for initial bug discovery.
- Any future telemetry addition requires a major Privacy Policy update, explicit UI disclosure, and must never track passive browsing history.
