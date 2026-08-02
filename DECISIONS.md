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

**Why**: Some sites use script-injected iframes for banner-like ad placements. A streaming-canary report showed a `600x200` iframe inside article layout with a `javascript:void(...document.write(script)...)` payload, no accessible text, and no standard ad-network URL.

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

**Why**: A streaming canary used a cross-origin full-page betting skin from
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

## 2026-06-20 - Scope DOM Scans To Mutated Subtrees

**Decision**: The `MutationObserver` now collects specific mutated and added `HTMLElement` targets into a pending set (`state.pendingScanNodes`), and the debounced `runScan` restricts `document.querySelectorAll()` to only search those subtrees instead of the entire document.

**Why**: YouTube and other dynamic SPAs (Single Page Applications) were experiencing severe lag. The previous implementation ran a full-document `querySelectorAll` for all 5,000+ cosmetic selectors every 80ms if *any* attribute on the page changed (e.g., a video player's progress bar). Scoping the queries prevents O(N) traversal over massive DOM trees.

**Consequences**:
- CPU overhead on YouTube and similar sites is drastically reduced.
- The initial load and manual resets (`force: true`) still perform a global `[document]` scan to ensure full coverage.
- The `collectCandidates` pipeline now iterates over context nodes, executing `context.matches()` for the context root and `context.querySelectorAll()` for its descendants.

## 2026-06-20 - Mitigate Engine Gotchas Without Adding Scriptlets

**Decision**: Address the v0.1 engine risks with bounded content-script and
release-contract changes: scan open shadow roots as explicit contexts, preserve
Clean-mode geometry with `visibility: hidden`, retry content-to-background DNR
allow messages, and fail generated/release DNR rulesets above 30,000 rules.
Keep anti-adblock scriptlets/main-world API monkey patches out of this release
cycle.

**Why**: These risks map to real failure modes already seen or likely to appear
in dogfooding: Shadow DOM misses, SPA layout correction loops, MV3 service
worker wakeup latency, and Chrome static ruleset limits. Scriptlets are a much
larger product and compatibility bet than these guardrails and would need a
separate architecture/eval pass.

**Consequences**:
- Open `ShadowRoot` trees are discovered with bounded tree walking, observed for
  later mutations, and receive local card CSS. Closed shadow roots remain
  impossible to inspect from a content script.
- Custom-element hosts with open shadow roots are not replacement targets; the
  actual ad slot inside the root is preferred so light-DOM cards are not hidden
  by shadow encapsulation.
- Clean/disabled replacement slots keep measurable boxes while visually hidden,
  reducing React/virtual-DOM layout thrash risk at the cost of leaving blank
  reserved space until refresh.
- `chrome.runtime.sendMessage` for page-level DNR allow sync is callback-checked
  and retried, but content UI must still not rely on synchronous service-worker
  behavior.
- `scripts/update-lists.mjs` and `scripts/test-release-contract.mjs` enforce
  the static ruleset cap, keeping list expansion curated instead of blind.
- The browser smoke now covers static and late-injected shadow ads,
  non-collapsing Clean layout, report-flow messaging, mixed rail safety, and
  multi-message Anchor merge behavior.

## 2026-07-02 - Store The Cosmetic Snapshot As JSON-Escaped Strings

**Decision**: `src/cosmetic-filters.js` no longer embeds the EasyList-derived
cosmetic snapshot in a JS template literal. The generator serializes every
filter line with `JSON.stringify` into an array joined at runtime, refuses to
write when the declaration regex does not match, and uses a function replacer
so `$`-patterns in rules cannot mutate output. The backtick pre-filter was
removed because escaping now happens structurally.

**Why**: The template-literal form let upstream EasyList text reach the content
script as live JS: a rule containing `${...}` would interpolate (best case a
top-level throw disabling all cosmetic filtering, worst case list-controlled
code execution on every page). Filtering only backticks was a band-aid around
an unsafe storage format.

**Consequences**:
- The shipped snapshot was converted with a byte-identical runtime round trip;
  no behavior change.
- `scripts/test-cosmetic-filters.mjs` now asserts hostile lines (interpolation,
  quotes, trailing backslashes, replacement patterns) survive serialization
  verbatim without executing, and fails if the template form ever returns.
- Rules containing backticks are no longer dropped from the snapshot.

## 2026-07-03 - Kill The Public Product; Archive The Project

**Decision**: Stop all engine and release work. Do not submit to the Chrome
Web Store. Archive the repository under `Hlib/archive/`. No further DNR rules,
DOM heuristics, UI fixes, or eval expansion.

**Why**: First real dogfooding session (2026-07-02/03) produced false
positives — non-ad content replaced — on ad-heavy sites, alongside continued
misses, despite a green automated harness (97/100 adblock-tester, 4/4
controlled evals). False positives were the failure mode the architecture was
explicitly built to avoid, and they are structural, not tunable: judging "what
counts as an ad" is exactly the human-triage moat that mature blockers built
over a decade of crowd-sourced reports. A solo maintainer cannot win that
whack-a-mole, and the maintainer no longer wants to use the tool — terminal
for a product whose adoption ask is "replace uBlock."

**Consequences**:
- The 2026-07-02 audit's kill condition fired early: the decisive test failed
  one layer below the notes thesis, so the Anchor hypothesis remains untested
  and may be revisited later on an ad-tech-free surface (e.g., new tab), as a
  fresh project after a grill, not a pivot of this codebase.
- Reusable assets to salvage: the Playwright unpacked-extension test rig, the
  hybrid live-eval harness pattern, the dependency-free release packager/zip
  writer, the SVG-to-PNG icon build via Playwright, and the JSON-escaped
  generated-artifact pattern from the injection fix.
- The engine work is treated as paid tuition: it bought a definitive answer
  about why ad blocking is a duopoly, plus post-mortem content material.

## 2026-07-03 - Correction: The Kill Narrative Overstated The Failure

**Decision**: Amend the same-day kill record. The "first real dogfooding
session" framing was false. Hlib manually tested on real sites continuously
from early June (ukr.net, Forbes, and streaming-canary reports; the 06-13 dogfooding
week), and those reports drove tuning throughout. His corrected assessment:
blocking was roughly 90% right on most sites, remaining misses were largely
shared with uBlock, and false positives appeared when detection was pushed
past the last safe checkpoint — not as first-contact structural collapse.
"Killed entirely" is retracted. The project is **parked as a public store
product**; repositioning under consideration: freeze-and-use privately,
open-source experiment, portfolio piece, kyii-studio graveyard entry.

**Why**: The close-out narrative drifted from the recorded evidence. The error
surfaced when content drafted from the kill brief misread the story and Hlib
flagged it. What still stands from the original decision: maintainer fatigue
with the store-launch fight, the crowd-sourced false-positive-triage moat
argument against beating mature blockers, and the maintenance treadmill of a
public store product. What does not stand: the claim that the product failed
on first contact with reality, and any implication that the engine is bad.

**Consequences**:
- The Anchor/notes thesis remains untested and testable: freezing detection at
  the safe checkpoint and using the extension privately is a viable path.
- eval-system's reference entry and the harvested content seeds were corrected.
- Real eval lesson kept: manual-testing findings lived in chat and STATUS
  prose instead of recorded eval results, which made the testing history easy
  to misremember at decision time. Human-pass sessions should be logged as
  first-class eval artifacts.

## 2026-07-03 - Detection Precision Pass: Full-Match Labels And Scoped Rungs

**Decision**: Before the month of private dogfooding, fix the false-positive
classes introduced by pushing detection past the safe checkpoint, using
evidence from bait pages (Wikipedia "Advertising"/«Реклама», HN, MDN) and a
new FP-capture harness (`scripts/diagnose-false-positives.mjs`) that records
the original content of every replaced slot. Changes:

1. **Labels match full strings, not substrings.** `AD_TEXT_RE` (substring)
   is replaced by `AD_LABEL_RE` + `hasAdLabel`: a leaf's entire text must be
   a known label ("Advertisement", "Sponsored Content", «Реклама», «На правах
   реклами», …). Checked on own text/aria-label/title and non-link leaf
   descendants. Guards: leaves inside `a` (nav links) or `p` (bolded prose
   words) don't count; leaf labels only count when the container's total text
   is ≤120 chars (icon legends and definition paragraphs are editorial).
2. **`promo` dropped from `AD_IDENTIFIER_RE`** (house-promo modules on nypost,
   dailymail, foodnetwork are content, not ads); `taboola|outbrain|mgid` added
   (keeps native-feed widgets caught by identifier instead of label).
3. **Sidebar blanket-pass removed from "common ad-sized slot".** Being in a
   sidebar at 300x250 is not evidence (social widgets, editorial cards). The
   true-positive pattern it carried — a bare no-text link wrapping a
   slot-filling image — got its own explicit condition
   (`isBareLinkedMediaSlot` + sidebar). `findLinkedMediaAdContainer` turned
   out to be dead code; the fixture had been passing through the blanket pass.
4. **"Ad-like source" refuses mixed containers** (`hasNonAdIframe`): one ad
   iframe inside a rail that also embeds a functional iframe (ukr.net mail
   widget) no longer condemns the whole rail.
5. **`cite_note|cite_ref|footnote` are hard-unsafe identifiers** — Wikipedia
   citation ids embed slugified article titles ("…_Ad_Really_Is_Worth…").

**Why**: The FP hunt showed every observed false positive came from four
mechanisms (substring labels, `promo`, sidebar+size, unscoped ad-source),
while every observed true positive had a stronger signal available. Accepted
tradeoff: leaf-label misses on long native teasers (>120 chars without ad
identifiers) and first-party sponsored commerce listings inside links —
conservative in the direction Hlib chose (misses tolerable, FPs kill trust).

**Consequences**:
- Bait pages: en-wiki 141→0, uk-wiki 2→0 replacements; HN/MDN stay 0.
- Real-site FP set (nypost house promos ×4, social widget, weather editorial
  cards ×2, nv.ua rights legend, ukr.net mixed rail, dailymail promo banner):
  all gone; dailymail/pravda/yahoo/espn/weather/nv.ua true positives intact.
- Full battery 25/27 pass (same two pre-existing exceptions: streaming-canary policy
  mismatch, msn bot-block). Cards 202→123; the drop is dominated by the
  killed FP classes. Controlled testers score via DNR, unaffected.
- Fixture gained an editorial bait gauntlet (`#fp-*`, `#cite_note-*`) asserted
  never-replaced in `npm run test:extension`, plus a badge-pattern native card
  (`#partner-story-card`) asserted replaced — the label path has a regression
  surface now.

## 2026-07-04 - Overlay Ads Are Hidden, Never Carded; aria-label Is Safety-Only

**Decision**: Two dogfooding-day-1 rules, from Hlib's first two field reports
(streaming-canary full-screen block; his own localhost:4321 tool condemned).

1. **Treatment contract: Tide cards only for in-flow slots.** A detected
   full-page branding takeover (`FULL_PAGE_TAKEOVER_REASON`) or any slot whose
   element is `position: fixed` at marking time takes the clean/hide path
   (`visibility: hidden` + `pointer-events: none`), never an ambient card.
   Rationale: a card inside a fixed overlay or viewport takeover occupies the
   screen exactly like the ad did — on the streaming canary the "replacement" was itself a
   full-screen block. Cards exist to preserve layout; overlays have no layout
   to preserve. Sticky elements stay carded (they occupy real flow space).
   Implementation note: overlay status must be captured into
   `dataset.attentionRedirectorOverlay` in `replaceCandidate` *before* slot
   classes apply — `--preserve-children` forces `position: relative
   !important`, so a render-time computed-style check alone misses fixed
   elements (caught by the AdThrive footer fixture).
2. **aria-label leaves identifier text.** `getIdentifierText` is machine
   identifiers only (id/class/data-* / tag); the ad-like-identifier rung
   condemns unconditionally, and aria-label is human prose — Hlib's tool with
   `aria-label="Ads conversion diagnostic constellation"` was condemned by the
   `ads` token. New `getSafetyIdentifierText` keeps aria-label for the six
   unsafe-identifier (veto) helpers: prose may still veto a replacement as
   unsafe, but can never condemn. Genuine `aria-label="Advertisement"` slots
   remain caught by the full-match `hasAdLabel` rung.

**Consequences**:
- Streaming canary: takeover still detected (`div#brnd…`, 1270x720) but hidden;
  page renders normally (before/after: `runs/fp-hunt/2026-07-04T08-19*` vs
  `…14-24-43*`).
- localhost:4321 (offer-triage): 1→0 replaced slots
  (`runs/fp-hunt/2026-07-04T14-24-30*`).
- Fixed-overlay fixtures (AdThrive footer, floating video, schulist bottom
  banner) asserted hidden-not-carded in `npm run test:extension`; new
  `#fp-aria-tool-map` fixture asserts aria-label prose never condemns.
  Anchor-rotation/quiet asserts moved from the AdThrive slot to `#top-ad`
  since overlay slots no longer render cards.

## 2026-07-04 - Overlay Ads Collapse Like Blocker Rules

**Decision**: Full-page takeovers and fixed overlay ads now use a collapsed
clean path (`display: none`, zero height/padding/margin/border) instead of the
normal Clean-mode layout-preserving path.

**Why**: The first overlay fix removed the Tide card but reused
`visibility: hidden` with preserved geometry. On the streaming canary, the replaced fixed
branding container also received the preserved-children slot class, which
forces `position: relative !important`; that turned a fixed 1270x720 takeover
into a hidden in-flow block and pushed the page down. Overlay ads have no
useful page layout to preserve, so they should behave like uBlock-style
cosmetic removal. In-flow Clean slots still preserve geometry to reduce
framework layout thrash.

**Consequences**:
- Overlay/takeover slots remain marked as `presentation="clean"` but collapse
  to a `0x0` box.
- Normal Clean-mode and disabled/open-page in-flow slots still use
  `visibility: hidden` and keep their measured space.
- Regression coverage now asserts fixed overlays and branding takeovers are
  display-none/zero-height, while non-overlay Clean slots remain hidden but
  noncollapsed.

## 2026-07-05 - Block An Embedded-Player Pre-Roll Ad Stack With Path-Scoped DNR

**Decision**: Add hand-curated DNR rules for a streaming canary's
embedded-player pre-roll stack, scoped to observed ad paths rather than whole
content hosts:
`franecki.net/assets/vendor/`, `franecki.net/assets/pack/`,
`franecki.net/js/ma.js`, `franecki.net/content/static/`,
`reichelcormier.bid/candy/`, `base.ashdi.vip/stats/stats_vast.php`,
`nogravity4.click`, and `video.unocdn.com/*_fix.mp4`.

**Why**: The canary embeds the player through `ashdi.vip/vod/...`. The actual
movie HLS stream comes from `ashdi.vip`/`*.ashdi.vip` segment URLs, so broad
blocking `ashdi.vip` would break playback. The visible pre-roll came from a
separate ad chain: VAST/vendor XML and scripts on `franecki.net`, identity
redirects on `reichelcormier.bid`, and a separate pre-roll MP4 observed on
`v.nogravity4.click`. A follow-up probe without the `nogravity` rule showed the
ad stack rotating the visible pre-roll media to
`video.unocdn.com/..._fix.mp4`, so the media layer also needs coverage. Public
search showed no normal-content footprint for `nogravity4.click`, and local
evidence only saw it as pre-roll media, so it is blocked at the domain level.
`video.unocdn.com` is more CDN-shaped, so it is limited to the observed
`*_fix.mp4` media pattern. A broader `franecki.net/js/` block was tested and
rejected because it prevented the ashdi player from initializing any video.
The top-page DOM cannot safely replace this because the ad is inside a
cross-origin player frame and rendered as a video source.

**Consequences**:
- Movie playback remains allowed through `ashdi.vip` HLS manifests and
  segment requests.
- The observed player frame no longer exposes `Реклама` / `Пропустити`
  pre-roll UI after play.
- The release contract now asserts these curated path-scoped rules remain
  packaged, so a future DNR cleanup cannot silently drop them.
- This is not a general video-CDN block; `ashdi.vip` remains untouched and
  `video.unocdn.com` is scoped to the observed ad-media filename pattern.

## 2026-07-06 - Add FreeWheel fwmrm.net Preroll Coverage

**Decision**: Add `||fwmrm.net^` to the curated DNR seed list.

**Why**: A live NBC Sports video probe showed a FreeWheel preroll ad decision
loading from `29773.v.fwmrm.net/ad/g/1?...slau=preroll...`. The extension
already blocked `ads.freewheel.tv`, but that did not cover this commonly used
FreeWheel ad-server host. `fwmrm.net` is an ad-management host, not the content
video CDN; the observed content source was `link.theplatform.com/...`, so this
is a safer generalization than blocking publisher or player domains.

**Consequences**:
- FreeWheel preroll JSON/script calls on `*.fwmrm.net` are now blocked across
  sites.
- This remains a network-layer rule; no DOM replacement or player-specific
  scriptlet behavior was added.
- NBC Sports remains an imperfect automated canary because its player errored
  in the harness even before a clean content-playback pass was established.
  Treat the rule as ad-host coverage, not as a fully verified NBC playback fix.

## 2026-07-06 - Add YouTube-Specific Player Ad Suppression

**Decision**: Add a YouTube-only document-start loader and main-world player-ad
layer, plus first-party YouTube ad endpoint DNR rules. The network rules block
`youtube.com/pagead/` and `youtube.com/api/stats/ads`. The main-world layer
prunes `adPlacements`, `adSlots`, and `playerAds` from YouTube player
responses, hides YouTube ad surfaces, clicks skip controls, fast-forwards ad
media when the player marks itself `ad-showing`, and uses a bounded
`loadVideoById(current v=)` recovery when YouTube is stuck in `ad-showing`
without a playable video. The loader checks stored settings first, so global
off and site-disabled YouTube pages pass through without injecting the
main-world script.

**Why**: YouTube ads are not covered by ordinary third-party ad-host blocking.
A baseline probe showed existing DNR blocked DoubleClick / GoogleSyndication
requests but first-party YouTube ad endpoints still loaded. Adding
`youtube.com/pagead/` and `youtube.com/api/stats/ads` blocked those requests,
but a Gangnam Style probe still entered `ad-showing` and played a 116-second
ad. Open uBlock filter evidence points at player-response pruning rather than
broad `googlevideo.com` blocking; broad `googlevideo.com` blocking would also
block real videos. The first implementation that replaced the whole `fetch`
`Response` object and trapped `ytInitialPlayerResponse` broke playback, so it
was rejected. The kept implementation preserves the native response object and
overrides only `text()` / `json()` for matched player responses, with a short
global prune loop instead of redefining YouTube globals.

**Consequences**:
- YouTube now has a narrow procedural layer; this is not a general scriptlet
  engine and should not be expanded casually.
- YouTube site disable remains meaningful: the loader does not inject the
  main-world script when `youtube.com` is disabled or the extension is globally
  off.
- Real content media stays on `googlevideo.com`; no broad media-CDN block was
  added.
- Live verification passed for Rick Astley, Gangnam Style, and Me at the zoo
  in `runs/youtube-probe/2026-07-06T09-58-15-406Z/`: all ended with
  `adShowing: false`, no player ad placements, and real content video playing.
- YouTube is a moving target. Treat this as dogfooding-grade coverage that may
  need maintenance when YouTube changes player internals.

## 2026-07-06 - Bypass Generic DOM Replacement on YouTube

**Decision**: Disable the generic Attention Redirector DOM scanner/replacement
observer on YouTube hosts while leaving DNR rules and the YouTube-specific
main-world player-ad layer active.

**Why**: Hlib reported browser lag with the extension enabled after the
YouTube blocker was added. A focused four-way performance probe on Gangnam
Style separated the layers:

- YouTube site-disabled: p95 ~16.8-33.4ms, script ~12-13%.
- DNR-only: p95 16.8ms, script ~13.8%, but YouTube remained in ad playback.
- Procedural/content path before the fix: p95 >1s, script >110%.
- Fully enabled before the fix: p95 >1s, script >110%.

The DNR layer was not the problem. The expensive path appeared only when the
procedural/content path was active. After bypassing generic DOM replacement on
YouTube, the same probe showed enabled YouTube back at p95 16.8ms and script
~12.4%, with `adShowing: false` and real content playback. The generic scanner
is useful on news/ad-heavy pages but poorly matched to YouTube's constantly
mutating SPA; YouTube now has a dedicated player-ad layer, so running both was
unnecessary risk.

**Consequences**:
- YouTube no longer gets normal Tide card replacement from the generic scanner.
  That is intentional; ad surfaces there are handled by DNR plus the YouTube
  player-ad layer.
- Other sites keep the existing generic DOM replacement engine.
- Startup and open-page site-disable semantics remain covered in
  `scripts/test-extension.mjs`.
- Verified artifacts: `runs/performance/youtube-2026-07-06T12-11-22-831Z/`,
  `runs/youtube-probe/2026-07-06T12-13-55-768Z/`, and
  `runs/performance/2026-07-06T12-16-21-997Z/`.

## 2026-07-06 - Back Off Generic Scanning on Large Zero-Hit Pages

**Decision**: Keep the generic DOM replacement engine active on normal pages,
but reduce no-op work on large pages that initially produce no replacements:
skip delayed full-document warmups when the initial large-page scan finds zero
insertions and zero candidates, require mutation-triggered scans to carry an
ad-shaped tag/attribute/source/shadow-root signal, add repeated zero-scan
backoff, and move the DOM-replacement-disabled-domain guard inside `runScan`.
Add `translate.google.com` to the protected utility-host bypass list.

**Why**: Tapstitch and Google Translate lagged badly with the extension enabled
despite inserting zero cards. Live probes separated the issue from the Tide
card renderer: Translate went from script ~129.8%, p99 584.5ms, and ~20.4s
long-task total to baseline after generic DOM replacement was bypassed;
Tapstitch improved from script ~19.0% and p99 66.7ms to script ~7.0% and p99
16.8ms after large zero-hit warmup/mutation scans were reduced. The previous
warmup and observer behavior was useful for late ad slots, but it burned
main-thread time on large app-like pages where the scanner repeatedly found
nothing.

**Consequences**:
- DNR rules, curated preroll rules, and the YouTube-specific player layer are
  unchanged.
- Google Translate intentionally receives no generic Tide/clean DOM
  replacement. That is acceptable for a protected utility page; network DNR
  still follows normal global/site settings.
- Delayed ads on very large pages that appear without ad-like tags,
  identifiers, sources, labels, or open shadow roots may be detected later or
  require a field report. This is accepted to avoid browser-wide lag from
  repeated blind scans.
- Existing browser smoke still covers late light-DOM and shadow-DOM ads, and
  the local 60-card benchmark remains smooth after the backoff.

## 2026-07-07 - Split Live Evals Into Regression, Discovery, and Manual Tracks

**Decision**: Expand `evals/live-sites.json` from a small ad-heavy real-site
list into a labeled matrix with `track` and `category` metadata. Keep the
default live eval small: default `npm run eval:live` / `eval:live:dry` selects
only regression and controlled cases. Broad discovery must be requested
explicitly with `--track discovery`; logged-in protected workflows are marked
`manualOnly` and cannot be executed by the automated runner.

**Why**: Antigravity/Gemini sweeps showed that broad automated browsing can
surface useful leads, but it also creates noisy findings: bot walls, login
walls, background tracker pings misclassified as missed ads, and shallow
homepage passes for apps that need logged-in workflow testing. The eval system
needs more coverage without making every live run huge or treating discovery
signals as release gates.

**Consequences**:
- Regression remains bounded at 23 real/risk-canary cases plus 4 controlled
  tester cases.
- Discovery now has 75 non-gating cases across news, sports, commerce,
  stock/search, video, productivity/public utility pages, reference/developer
  sites, community, finance, travel/jobs, and health/lifestyle.
- Manual protected checks cover Docs, Gmail, Drive, Figma editor, Canva editor,
  Notion, Amazon cart, and Reddit feed/comments. The runner exits before
  launching if a manual-only case is selected for execution; `--dry-run` lists
  them for human testing.
- Reports now carry `track` and `category`, making Antigravity/Gemini triage
  easier to cluster without patching from raw noisy output.

## 2026-07-07 - Prioritize Domain-Scoped Cosmetic Rules Before Generic Chunks

**Decision**: Run a small bounded priority pass for domain-scoped cosmetic
rules before the generic chunked cosmetic selector scan. Add
`amazon.com##.s-left-ads-item` as a domain-scoped seed rule for Amazon's
sponsored left-rail search ad.

**Why**: The discovery commerce sweep found a visible Amazon search ad:
`div.s-left-ads-item` containing a 160x600
`ape_Search_auto-left-advertising...` iframe and `Sponsored` text. Adding the
domain-scoped selector alone was not enough because the scanner batches many
cosmetic selectors into comma-separated chunks and then caps each chunk to the
first 60 DOM-order matches. On large pages, a specific host rule can be
crowded out by earlier generic matches even though the parser loaded it
correctly. Host-specific rules are few and usually come from field evidence, so
they should get a bounded first pass.

**Consequences**:
- Amazon's left-rail sponsored search ad is now removed without broad Amazon
  product-card matching.
- The priority pass is bounded to 20 matches per domain-scoped rule and the
  existing 260 cosmetic candidate cap, preserving the scanner's performance
  constraints.
- Generic EasyList-style cosmetic scanning remains chunked for performance.
- Future host-specific rules should still be added conservatively and backed
  by either a field report or live eval reproduction.

## 2026-07-08 - Treat Stock-Search Affiliate Modules as Host-Scoped Cosmetics

**Decision**: Block the observed iStock/Getty affiliate modules on Pexels and
Unsplash with narrow host-scoped cosmetic rules, not global stock-media or
Getty/iStock network/source rules.

**Why**: Pexels and Unsplash embed these promotions as first-party search
content. Pexels fetches Getty media through first-party endpoints and renders
`media.istockphoto.com` images inside dedicated sponsored module wrappers.
Unsplash renders a premium iStock block with `data-ad="true"` and sponsored
outbound links. Globally blocking `istockphoto.com`, `media.istockphoto.com`,
or Getty-like source text would be too broad: stock media URLs can appear as
legitimate search/reference/product content, and network blocking could leave
broken empty grids.

**Consequences**:
- Pexels search results now target only the observed
  `Inline_container__*`, `FullWidth_wrapper__*`, and
  `AIGCShared_container__*` sponsored/promo module wrappers.
- Unsplash targets only host-local `[data-ad="true"]` modules, which matched
  the captured iStock premium block and a separate brand-content promo block.
- Own `data-ad="true"` now counts as explicit ad-slot evidence for safety
  purposes, so cosmetic matches are not vetoed merely because they live inside
  search-result containers. The attribute alone still does not create a
  replacement reason.
- Current-host domain-scoped cosmetic rules can now wake mutation scans when a
  matching node hydrates late. Generic cosmetic rules still do not wake scans
  on arbitrary mutations, preserving the large-page performance backoff.
- Oversized current-host domain-scoped cosmetic matches can pass the normal
  large-ad safety gate only when bounded to roughly the viewport, and they
  collapse as Clean blocker removals instead of rendering giant Tide cards.
- This may miss future renamed Pexels CSS-module wrappers, but that is a
  safer failure mode than global stock-media false positives.
- Verified Pexels live with 3 replacement cards and 0 visible suspects, and
  Unsplash live with 2 replacement cards and 0 visible suspects.

## 2026-07-08 - Protect Canva and Current Notion Domain as App Surfaces

**Decision**: Add `canva.com` to the hard sensitive/protected domain lists for
content-script DOM replacement, background DNR allow rules, and the pure
site-policy classifier. Also add `notion.com` beside the existing `notion.so`
entries because live productivity evals now redirect Notion's public surface
to `www.notion.com`.

**Why**: Logged-in design/workspace editors are high false-positive-risk app
surfaces and low value targets for visual ad replacement. Canva was already in
the manual protected eval set but was not in the hard domain lists. The
`discovery-productivity` run then showed the same alias drift risk for Notion:
the initial `notion.so` URL classified as protected, but the final
`notion.com` host was standard until the alias was added.

**Consequences**:
- Canva and Notion app surfaces now exit the content script early like Figma,
  Docs, Gmail, and Drive.
- Their initiator domains receive the same high-priority DNR allow treatment
  as other known sensitive domains.
- Public homepages may no longer receive Tide/cosmetic replacement, which is
  intentional for these app brands; ad blocking value there is lower than
  avoiding editor breakage.
- No new ad detection rules, DNR block rules, or broader heuristics were added.

## 2026-07-15 - Un-Park The Public Release; GPLv3; Detection Freeze

**Decision**: Reverse the 2026-07-03 parking of the public product. Target:
Chrome Web Store release + open-source repo + KYII portfolio piece. The
~08-02 dogfood window stays as the store-submission gate; release prep (UI/
brand pass, store compliance, repo hygiene) runs in parallel. License the
repo GPLv3. Declare a detection freeze: until release, detection changes
only from field-reported false positives verified with bait-page + FP-hunt
runs — no new miss-coverage patches.

**Why**: Twelve days of dogfooding as the only ad blocker produced the
signal the window was armed to collect: daily use held, blocking is
competitive with the prior ad blocker on Hlib's real sites, and the
replacement messages deliver the intended value. The parts of the kill
decision that survived the 2026-07-03 correction (crowd-sourced FP-triage
moat, maintenance treadmill) are addressed by positioning, not engineering:
a calm focus tool, conservative by design, no full-adblock-parity claims —
not "replace uBlock." GPLv3 because packaged artifacts derive from EasyList
(GPLv3/CC BY-SA dual-licensed); MIT would require segregating the generated
lists from the code.

**Consequences**:
- Store submission is gated on the window closing clean (no uBlock
  reinstall, FP annoyances stay rare). Sequencing after the gate: open
  source + portfolio first, store submission second.
- The detection freeze keeps the dogfood signal clean and honors the
  ukr.net patch-loop lesson; discovery evals become non-gating FP/breakage
  canaries, not miss-hunting grounds.
- Before the repo goes public: decide eval-case optics (pirate-streaming
  references in `evals/live-sites.json`, `rules/rules_1.json`, and project
  docs) and review README/docs framing for a public audience.
- A private remote backup should exist before any further multi-day work
  accumulates; the repo had no remote as of this decision.

## 2026-07-18 - Named Presence Modes; Slot-Collapse Removal; First-Run Page

**Decision**: Three UI/brand decisions during the Lane B pass.

1. Replace the 0–10 "visual presence" slider with three named modes —
   **Clean / Balanced / Full Ambient** — mapping to the existing stored
   `visualPresence` values 0 / 5 / 10. No data-model change: the probabilistic
   `hashString(surfaceKey) % 10 < presence` logic is untouched; only the UI and
   the written value snap to those three points.
2. On the Clean end (and the removed share of partial presence), collapse
   in-flow slots **out of flow** (`display:none`, zero box) so the page reflows
   like an ad blocker, instead of `visibility:hidden` which left an empty gap.
   Overlay/takeover and oversized-cosmetic slots already collapsed; this extends
   the same treatment to actively-cleaned in-flow slots. When the extension or a
   site is simply turned off we still only hide, so a refresh restores the
   original layout.
3. Add a first-run onboarding page (`welcome.html`) opened by the service worker
   on `onInstalled` reason `install`, rather than a multi-step setup wizard.

**Why**: Eleven slider steps asked the user to reason about a fraction they
can't predict; named modes state the three real intents plainly (Jobs-minimal
house preference: one smart default + a few buttons, no exposed config).
Slot-collapse closes the most common "empty space where the ad was" complaint
without a filter-list treadmill. Onboarding leads with feel (a themed Tide field
+ a before→after transformation demo) instead of a configuration gate, matching
the "lead creative work with feel, not process" preference.

**Consequences**:
- `visualPresence` stays the storage key and the engine contract; any legacy
  non-{0,5,10} value renders as the nearest mode and rewrites to 0/5/10 on save.
- **Balanced** is the only mixed-output mode (some slots Tide, some removed on
  the same page); if it reads as inconsistent in dogfood, drop to Clean /
  Full Ambient only.
- Reserved-height ancestor wrappers still leave a gap after slot-collapse — the
  remaining uBlock-parity case. Deferred until after release; the choice there
  is a bounded reversible ancestor-collapse heuristic (moderate risk of
  over-collapsing real layout) vs. curated per-site cosmetic filter lists (large
  ongoing content-ops effort). Needs live-site dogfood before enabling either.
- Onboarding is an extension page opened in a tab; no `web_accessible_resources`
  entry is needed since the extension opens it itself via `getURL`.

## 2026-08-01 - Bypass Generic DOM Replacement on LinkedIn

**Decision**: Add `linkedin.com` to the runtime's DOM-replacement-disabled
domain list. Keep static DNR network rules active on LinkedIn; do not add it to
the sensitive-domain/DNR allow lists.

**Why**: Two authenticated dogfood reports exposed app-UI risk: an occasional
header-dropdown false positive and a repeatable My Network infinite-scroll
error that disappeared when the extension was disabled for the site. The DNR
rules target explicit LinkedIn ad/analytics paths, not normal My Network
pagination. Generic replacement, however, mutates candidate nodes and guards
those mutations against framework reconciliation, which is unsafe on a
virtualized authenticated app surface. A host bypass is more reliable than
chasing LinkedIn's changing component classes.

**Consequences**:
- LinkedIn receives DNR-only blocking: no Tide cards, Clean DOM removal,
  cosmetic replacement, mutation scans, or inspector candidates from the
  generic engine.
- The narrow LinkedIn ad/analytics request rules remain active.
- This deliberately accepts visible first-party promoted modules that DNR
  cannot remove in exchange for protecting navigation, pagination, messaging,
  and other app workflows.
- Browser coverage asserts both initial and late LinkedIn-like ad nodes remain
  untouched while the DNR probe is still blocked. Authenticated My Network
  scrolling remains a manual verification because the test profile has no
  LinkedIn session.

## 2026-08-02 - Remove Named Pirate-Streaming References From Public Artifacts

**Decision**: Resolve the eval-case optics gate the 2026-07-15 un-park decision
required "before the repo goes public". No pirate-streaming site is named in
any tracked file; the engineering lessons learned from it are kept in full.
Specifically:

- `HOSTILE_DOMAINS` in `src/site-policy.js` is now empty. The hostile tier is
  unchanged and still reached through observed page signals (takeover iframes,
  popup tabs, redirect traps, fake download buttons).
- The named live eval case was removed. The default regression + controlled
  track is now 26 cases (was 27).
- The named site-policy unit case was removed; hostile-tier coverage is carried
  by the pre-existing signal-driven case.
- `docs/site-risk-policy.md`, `STATUS.md`, and `DECISIONS.md` prose now refer to
  "the streaming canary" instead of the site.
- The curated ad-chain DNR rules are **kept** (`franecki.net` paths,
  `reichelcormier.bid/candy/`, `base.ashdi.vip/stats/stats_vast.php`,
  `nogravity4.click`, `video.unocdn.com/*_fix.mp4`), as is the release-contract
  assertion that they stay packaged.

**Why**: Hlib's call was that pirate streaming must not be mentioned in public
references while the lessons are preserved. A blocklist entry is coverage, not
a mention: those hostnames are ad/VAST endpoints indistinguishable from the
thousands of ad hosts already in the packaged rulesets, and dropping them would
discard real pre-roll coverage — the lesson itself. What reads as an
endorsement or a target is the *site name* in docs, evals, tests, and a shipped
hostile-domain list, so that is what was removed. Emptying `HOSTILE_DOMAINS`
cost nothing because the tier was always reachable from behavior; arguably the
signal-driven path is the better design and the hardcoded name was the
shortcut.

**Consequences**:
- The regression track loses its only live hostile-tier case. Hostile
  classification is still unit-tested from signals, but no live site exercises
  it end to end.
- The site is no longer pre-classified hostile before signals appear; it would
  escalate on observed takeover/popup behavior instead.
- `ashdi.vip` still appears as a CDN hostname in the kept DNR rule and in the
  decision rationale explaining why content CDNs must not be blocked wholesale.
  Open to reversal if Hlib wants zero trace.
