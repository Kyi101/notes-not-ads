async function runScan({ force, contextNodes = [document] }) {
  if (!state.settingsReady) {
    return 0;
  }

  if (!state.settings) {
    state.settings = await loadSettings();
  }

  if (!isPageAllowed(state.settings) || state.isScanning) {
    return 0;
  }

  state.isScanning = true;
  let inserted = 0;

  try {
    const candidates = collectCandidates(
      expandScanContexts(force ? [document] : contextNodes)
    );

    for (const candidate of candidates) {
      if (!force && inserted >= 6) {
        break;
      }

      if (replaceCandidate(candidate)) {
        inserted += 1;
        state.inserted += 1;
      }
    }
  } finally {
    state.isScanning = false;
    if (state.pendingScanNodes && state.pendingScanNodes.size > 0) {
      scheduleScan(80);
    }
  }

  return inserted;
}

function collectCandidates(contextNodes = [document]) {
  state.cosmeticMatches = new WeakMap();
  const rawNodes = [];

  for (const context of contextNodes) {
    if (!context) continue;
    if (context instanceof HTMLElement && context.matches(SCAN_SELECTOR)) {
      rawNodes.push(context);
    }
    if (context.querySelectorAll) {
      rawNodes.push(...Array.from(context.querySelectorAll(SCAN_SELECTOR)));
    }
  }

  const nodes = [
    ...rawNodes,
    ...collectCosmeticCandidateNodes(contextNodes)
  ];
  const candidates = [];
  const seen = new Set();

  for (const node of nodes) {
    const cosmeticMatch = state.cosmeticMatches.get(node);
    const candidate = getCandidateElement(node);
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    if (cosmeticMatch) {
      state.cosmeticMatches.set(candidate, cosmeticMatch);
    }

    const reason = getMatchReason(candidate);
    if (!reason) {
      continue;
    }

    candidate.dataset.attentionRedirectorReason = reason;
    candidates.push(candidate);
    seen.add(candidate);
  }

  return candidates
    .filter((candidate) => !hasCandidateDescendant(candidate, candidates))
    .sort((a, b) => getArea(a) - getArea(b));
}

function collectCosmeticCandidateNodes(contextNodes = [document]) {
  const nodes = [];
  const seen = new Set();
  const maxMatches = 260;

  if (!state.cosmeticRuleChunks) {
    state.cosmeticRuleChunks = [];
    let currentChunk = [];
    for (const rule of state.cosmeticRules) {
      currentChunk.push(rule);
      if (currentChunk.length >= 60) {
        state.cosmeticRuleChunks.push(currentChunk);
        currentChunk = [];
      }
    }
    if (currentChunk.length > 0) {
      state.cosmeticRuleChunks.push(currentChunk);
    }
    for (const chunk of state.cosmeticRuleChunks) {
      try {
        chunk.selectorString = chunk.map(r => r.selector).join(', ');
        document.querySelector(chunk.selectorString); // test if valid
      } catch (e) {
        chunk.selectorString = null; // force individual fallback if invalid selector in chunk
      }
    }
  }

  for (const chunk of state.cosmeticRuleChunks) {
    let matches = [];

    if (chunk.selectorString) {
      for (const context of contextNodes) {
        if (!context) continue;
        try {
          if (context instanceof HTMLElement && context.matches(chunk.selectorString)) {
            if (!matches.includes(context)) matches.push(context);
          }
          if (context.querySelectorAll) {
            const found = Array.from(context.querySelectorAll(chunk.selectorString));
            for (const el of found) {
              if (!matches.includes(el)) matches.push(el);
            }
          }
        } catch (_error) {}
      }
    } else {
      for (const rule of chunk) {
        for (const context of contextNodes) {
          if (!context) continue;
          try {
            if (context instanceof HTMLElement && context.matches(rule.selector)) {
              if (!matches.includes(context)) matches.push(context);
            }
            if (context.querySelectorAll) {
              const ruleMatches = Array.from(context.querySelectorAll(rule.selector));
              for (const el of ruleMatches) {
                if (!matches.includes(el)) matches.push(el);
              }
            }
          } catch (e) {}
        }
      }
    }

    for (const element of matches.slice(0, 60)) {
      if (!(element instanceof HTMLElement) || seen.has(element)) {
        continue;
      }

      const matchingRule = chunk.find(r => {
        try { return element.matches(r.selector); } catch(e) { return false; }
      });

      if (matchingRule) {
        state.cosmeticMatches.set(element, matchingRule);
        nodes.push(element);
        seen.add(element);

        if (nodes.length >= maxMatches) {
          return nodes;
        }
      }
    }
  }

  return nodes;
}

function getCandidateElement(node) {
  if (!(node instanceof HTMLElement)) {
    return null;
  }

  const brandingTakeover = findBrandingTakeoverContainer(node);
  if (brandingTakeover) {
    return brandingTakeover;
  }

  let candidate = node;

  if (node.matches("iframe,img,embed,amp-ad")) {
    const parent = node.parentElement;
    if (parent && safeToReplace(parent) && hasSimilarRect(node, parent)) {
      candidate = parent;
    }
  }

  return promoteToAdWrapper(candidate);
}

function hasCandidateDescendant(candidate, candidates) {
  return candidates.some((other) => {
    return (
      other !== candidate &&
      candidate.contains(other) &&
      !isAdWrapperCandidate(candidate, other)
    );
  });
}

function promoteToAdWrapper(element) {
  if (VIDEO_AD_IDENTIFIER_RE.test(getIdentifierText(element))) {
    return element;
  }

  let current = element;
  let best = element;
  let depth = 0;

  while (current && current !== document.body && depth < 7) {
    if (
      current instanceof HTMLElement &&
      !isExtensionElement(current) &&
      isAdWrapperCandidate(current, element)
    ) {
      best = current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return best;
}

function isAdWrapperCandidate(element, origin = element) {
  if (!(element instanceof HTMLElement) || isExtensionElement(element)) {
    return false;
  }

  if (element.matches("html,body,main,article,nav,header,footer,form")) {
    return false;
  }

  if (hasHardUnsafeAncestor(element) || hasHardUnsafeIdentifier(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const brandingTakeover = isBrandingTakeover(element);
  if (
    !isVisibleRect(rect) ||
    (isTooLargeForExplicitAd(rect) && !brandingTakeover)
  ) {
    return false;
  }

  if (origin && origin !== element) {
    const originRect = origin.getBoundingClientRect();
    if (!rectContainsMost(rect, originRect)) {
      return false;
    }
  }

  if (element.querySelector("form,input,textarea,select,[contenteditable='true']")) {
    return false;
  }

  const identifiers = getIdentifierText(element);
  const textLabel = getShortLabelText(element);
  const sources = getSourceValues(element).join(" ");

  return Boolean(
    brandingTakeover ||
      AD_IDENTIFIER_RE.test(identifiers) ||
      VIDEO_AD_IDENTIFIER_RE.test(identifiers) ||
      AD_TEXT_RE.test(textLabel) ||
      AD_SOURCE_RE.test(sources)
  );
}

function rectContainsMost(containerRect, childRect) {
  const overlapLeft = Math.max(containerRect.left, childRect.left);
  const overlapTop = Math.max(containerRect.top, childRect.top);
  const overlapRight = Math.min(containerRect.right, childRect.right);
  const overlapBottom = Math.min(containerRect.bottom, childRect.bottom);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);
  const childArea = childRect.width * childRect.height;

  if (childArea <= 0) {
    return false;
  }

  return (overlapWidth * overlapHeight) / childArea >= 0.85;
}

function getMatchReason(element) {
  if (!safeToReplace(element)) {
    return "";
  }

  if (isBrandingTakeover(element)) {
    return "full-page branding takeover";
  }

  const cosmeticMatch = getCosmeticMatch(element);
  if (cosmeticMatch) {
    return `cosmetic filter: ${cosmeticMatch.selector}`;
  }

  const identifiers = getIdentifierText(element);
  const textLabel = getShortLabelText(element);
  const rect = element.getBoundingClientRect();
  const hasAdIdentifier = AD_IDENTIFIER_RE.test(identifiers);
  const hasBannerIdentifier = BANNER_IDENTIFIER_RE.test(identifiers);
  const hasAdText = AD_TEXT_RE.test(textLabel);
  const hasAdSource = hasAdLikeSource(element);
  const hasScriptIframe = hasScriptAdIframe(element);
  const hasCommonSize = isCommonAdSize(rect);

  if (hasAdIdentifier) {
    return "ad-like identifier";
  }

  if (hasAdText && (isSmallContainer(rect) || isSidebarElement(element))) {
    return "sponsored label";
  }

  if (hasBannerIdentifier && hasCommonSize && !isLikelyHeroBanner(element)) {
    return "banner-sized slot";
  }

  if (hasCommonSize && (hasAdSource || hasAdText || isSidebarElement(element))) {
    return "common ad-sized slot";
  }

  if (hasAdSource && (hasAdText || isFixedOrSticky(element) || isSmallContainer(rect))) {
    return "ad-like source";
  }

  if (hasScriptIframe && isSmallContainer(rect)) {
    return "script iframe slot";
  }

  return "";
}

function safeToReplace(element) {
  if (!element || element.dataset.attentionRedirectorReplaced === "true") {
    return false;
  }

  if (element === document.body || element === document.documentElement) {
    return false;
  }

  if (element.matches("main,article,header,footer")) {
    return false;
  }

  if (element.shadowRoot) {
    return false;
  }

  if (containsExplicitVideoAdLayer(element) && !hasOwnAdIdentifier(element)) {
    return false;
  }

  if (hasHardUnsafeAncestor(element)) {
    return false;
  }

  const strongAdSignal = hasStrongAdSignal(element);
  const explicitAdSlot = isExplicitAdSlot(element);

  if (
    (hasHardUnsafeIdentifier(element) ||
      hasHardUnsafeIdentifierInAncestors(element)) &&
    !explicitAdSlot
  ) {
    return false;
  }

  if (
    (hasSoftUnsafeAncestor(element) ||
      hasSoftUnsafeIdentifier(element) ||
      hasSoftUnsafeIdentifierInAncestors(element)) &&
    !strongAdSignal
  ) {
    return false;
  }

  if (element.querySelector("form,input,textarea,select,[contenteditable='true']")) {
    return false;
  }

  if (closestAcrossRoots(element, "a[href]") && !hasAdLikeSource(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (!isVisibleRect(rect)) {
    return false;
  }

  if (isNarrowContentRail(element, rect)) {
    return false;
  }

  if (
    isTooLargeForMvp(rect) &&
    !isBrandingTakeover(element) &&
    !canReplaceExplicitLargeAd(element, rect)
  ) {
    return false;
  }

  return true;
}

function hasStrongAdSignal(element) {
  const identifiers = getIdentifierText(element);
  const textLabel = getShortLabelText(element);
  const rect = element.getBoundingClientRect();

  return Boolean(
    isBrandingTakeover(element) ||
      hasCosmeticMatch(element) ||
      AD_IDENTIFIER_RE.test(identifiers) ||
      VIDEO_AD_IDENTIFIER_RE.test(identifiers) ||
      AD_TEXT_RE.test(textLabel) ||
      hasAdLikeSource(element) ||
      hasScriptAdIframe(element) ||
      (isCommonAdSize(rect) &&
        (AD_SOURCE_RE.test(getSourceValues(element).join(" ")) ||
          AD_IDENTIFIER_RE.test(identifiers)))
  );
}

function isExplicitAdSlot(element) {
  const identifiers = getIdentifierText(element);
  const textLabel = getShortLabelText(element);
  const sourceText = getSourceValues(element).join(" ");
  const rect = element.getBoundingClientRect();

  if (isBrandingTakeover(element)) {
    return true;
  }

  if (AD_SOURCE_RE.test(sourceText)) {
    return true;
  }

  if (hasScriptAdIframe(element)) {
    return true;
  }

  if (AD_TEXT_RE.test(textLabel) && element.matches("iframe,ins,amp-ad")) {
    return true;
  }

  if (
    /(google_ads_iframe|div-gpt-ad|adsbygoogle|adthrive|safeframe|doubleclick|googlesyndication|ima-ad-container)/i.test(
      `${identifiers} ${sourceText}`
    )
  ) {
    return true;
  }

  return Boolean(
    AD_IDENTIFIER_RE.test(identifiers) &&
      (AD_TEXT_RE.test(textLabel) ||
        isCommonAdSize(rect) ||
        element.matches("iframe,ins,amp-ad"))
  );
}

function isFixedOrSticky(element) {
  const style = window.getComputedStyle(element);
  return style.position === "fixed" || style.position === "sticky";
}

function hasScriptAdIframe(element) {
  const frames = element.matches("iframe")
    ? [element]
    : Array.from(element.querySelectorAll("iframe")).slice(0, 6);

  return frames.some((frame) => {
    if (!(frame instanceof HTMLElement)) {
      return false;
    }

    const sourceText = getSourceValues(frame).join(" ");
    if (!SCRIPT_IFRAME_SOURCE_RE.test(sourceText)) {
      return false;
    }

    const rect = frame.getBoundingClientRect();
    return (
      rect.width >= 250 &&
      rect.height >= 80 &&
      rect.height <= 340 &&
      rect.width <= Math.max(1000, window.innerWidth * 0.9)
    );
  });
}

function findBrandingTakeoverContainer(element) {
  let current = element;
  let depth = 0;

  while (current && current !== document.body && depth < 4) {
    if (current instanceof HTMLElement && isBrandingTakeover(current)) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function isBrandingTakeover(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const coversViewport =
    rect.width >= window.innerWidth * 0.85 &&
    rect.height >= window.innerHeight * 0.8 &&
    rect.left <= window.innerWidth * 0.1 &&
    rect.top <= window.innerHeight * 0.1;

  if (!coversViewport) {
    return false;
  }

  const identifiers = getIdentifierText(element);
  const sources = getSourceValues(element).join(" ");
  if (
    !BRANDING_TAKEOVER_IDENTIFIER_RE.test(identifiers) ||
    !BRANDING_TAKEOVER_SOURCE_RE.test(sources)
  ) {
    return false;
  }

  let current = element;
  let depth = 0;

  while (current && current !== document.body && depth < 4) {
    if (
      current instanceof HTMLElement &&
      window.getComputedStyle(current).position === "fixed"
    ) {
      return true;
    }

    current = current.parentElement;
    depth += 1;
  }

  return false;
}

function loadCosmeticRulesForPage() {
  const api = globalThis.AttentionRedirectorCosmeticFilters;
  if (!api || typeof api.getRulesForHost !== "function") {
    return [];
  }

  try {
    return api.getRulesForHost(location.hostname);
  } catch (_error) {
    return [];
  }
}

function getCosmeticMatch(element) {
  return state.cosmeticMatches.get(element) || null;
}

function hasCosmeticMatch(element) {
  return Boolean(getCosmeticMatch(element));
}

function hasOwnAdIdentifier(element) {
  const identifiers = getIdentifierText(element);
  return AD_IDENTIFIER_RE.test(identifiers) || VIDEO_AD_IDENTIFIER_RE.test(identifiers);
}

function containsExplicitVideoAdLayer(element) {
  return Array.from(element.querySelectorAll("[id],[class],[aria-label]")).some(
    (child) => {
      return (
        child !== element &&
        child instanceof HTMLElement &&
        VIDEO_AD_IDENTIFIER_RE.test(getIdentifierText(child))
      );
    }
  );
}

function inspectElement(element, extraReasons = []) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  const identifiers = getIdentifierText(element);
  const textSnippet = getShortLabelText(element);
  const sources = getSourceValues(element);
  const reasons = [...extraReasons];
  const zIndex = Number.parseInt(style.zIndex, 10);
  const highZIndex = Number.isFinite(zIndex) && zIndex >= 100;
  const fixedOrSticky =
    style.position === "fixed" || style.position === "sticky";
  let score = extraReasons.length ? 2 : 0;

  if (AD_IDENTIFIER_RE.test(identifiers)) {
    score += 4;
    reasons.push("ad-like identifier");
  }

  if (BANNER_IDENTIFIER_RE.test(identifiers)) {
    score += 2;
    reasons.push("banner-like identifier");
  }

  if (AD_TEXT_RE.test(textSnippet)) {
    score += 3;
    reasons.push("ad/sponsor text");
  }

  if (AD_SOURCE_RE.test(sources.join(" "))) {
    score += 4;
    reasons.push("ad-like source URL");
  }

  const cosmeticMatch = getCosmeticMatch(element);
  if (cosmeticMatch) {
    score += 4;
    reasons.push(`cosmetic filter: ${cosmeticMatch.selector}`);
  }

  if (isCommonAdSize(rect)) {
    score += 2;
    reasons.push("common ad size");
  }

  if (isSidebarElement(element)) {
    score += 1;
    reasons.push("sidebar/rail placement");
  }

  if (fixedOrSticky && isVisibleRect(rect)) {
    score += 1;
    reasons.push(`${style.position} positioning`);
  }

  if (highZIndex) {
    score += 1;
    reasons.push("high z-index");
  }

  if (isPopupLike(element, style, rect, highZIndex)) {
    score += 3;
    reasons.push("popup-like overlay");
  }

  if (isAnimatedElement(element, style)) {
    score += 1;
    reasons.push("animated element");
  }

  if (hasUnsafeIdentifier(element)) {
    reasons.push("unsafe identifier present");
  }

  const uniqueReasons = Array.from(new Set(reasons));

  return {
    element,
    signature: getElementSignature(element),
    reasons: uniqueReasons,
    score,
    wouldReplace: Boolean(getMatchReason(element)),
    safetyBlocks: getSafetyBlocks(element),
    rect: {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      area: rect.width * rect.height
    },
    css: {
      position: style.position,
      zIndex: style.zIndex,
      display: style.display,
      opacity: style.opacity
    },
    role: element.getAttribute("role") || "",
    ariaLabel: element.getAttribute("aria-label") || "",
    textSnippet,
    sources,
    ancestry: getAncestry(element)
  };
}

function getSafetyBlocks(element) {
  const blocks = [];

  if (!element || element.dataset.attentionRedirectorReplaced === "true") {
    blocks.push("already replaced or invalid");
    return blocks;
  }

  if (element === document.body || element === document.documentElement) {
    blocks.push("page root");
  }

  if (element.matches("main,article,header,footer")) {
    blocks.push("structural page section");
  }

  if (element.shadowRoot) {
    blocks.push("open shadow host");
  }

  if (containsExplicitVideoAdLayer(element) && !hasOwnAdIdentifier(element)) {
    blocks.push("contains explicit video ad child");
  }

  if (isExtensionElement(element)) {
    blocks.push("extension UI");
  }

  const strongAdSignal = hasStrongAdSignal(element);
  const explicitAdSlot = isExplicitAdSlot(element);

  if (hasHardUnsafeAncestor(element)) {
    blocks.push("unsafe ancestor");
  }

  if (hasSoftUnsafeAncestor(element) && !strongAdSignal) {
    blocks.push("unsafe ancestor");
  }

  if (
    (hasHardUnsafeIdentifier(element) ||
      hasHardUnsafeIdentifierInAncestors(element)) &&
    !explicitAdSlot
  ) {
    blocks.push("unsafe identifier");
  }

  if (
    (hasSoftUnsafeIdentifier(element) ||
      hasSoftUnsafeIdentifierInAncestors(element)) &&
    !strongAdSignal
  ) {
    blocks.push("unsafe identifier");
  }

  if (element.querySelector("form,input,textarea,select,[contenteditable='true']")) {
    blocks.push("contains form/editor controls");
  }

  if (closestAcrossRoots(element, "a[href]") && !hasAdLikeSource(element)) {
    blocks.push("inside normal link");
  }

  const rect = element.getBoundingClientRect();
  if (!isVisibleRect(rect)) {
    blocks.push("not visibly sized");
  }

  if (isNarrowContentRail(element, rect)) {
    blocks.push("mixed narrow content rail");
  }

  if (isTooLargeForMvp(rect) && !canReplaceExplicitLargeAd(element, rect)) {
    blocks.push("too large for normal replacement");
  }

  return Array.from(new Set(blocks));
}

function isExtensionElement(element) {
  return Boolean(
    closestAcrossRoots(
      element,
      ".attention-redirector-slot,.attention-redirector-card,.attention-redirector-inspector,.attention-redirector-inspector-box,.attention-redirector-manual-hover,.attention-redirector-manual-capture,.attention-redirector-style"
    )
  );
}

function isPopupLike(element, style, rect, highZIndex) {
  if (style.position !== "fixed") {
    return false;
  }

  const viewportArea = window.innerWidth * window.innerHeight;
  const area = rect.width * rect.height;
  const largeEnough = rect.width >= 220 && rect.height >= 110;
  const centered =
    rect.left > 20 &&
    rect.top > 20 &&
    rect.right < window.innerWidth - 20 &&
    rect.bottom < window.innerHeight - 20;

  return (
    largeEnough &&
    area >= viewportArea * 0.06 &&
    (highZIndex || centered || hasCloseControl(element))
  );
}

function hasCloseControl(element) {
  const controls = Array.from(
    element.querySelectorAll("button,a,[role='button'],[aria-label],[title]")
  ).slice(0, 20);

  return controls.some((control) => {
    const label = [
      control.textContent,
      control.getAttribute("aria-label"),
      control.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();

    return /(^|\b)(close|dismiss|hide|no thanks|not now|skip)(\b|$)|^x$/.test(
      label
    );
  });
}

function isAnimatedElement(element, style) {
  const hasAnimation =
    style.animationName &&
    style.animationName !== "none" &&
    parseCssTime(style.animationDuration) > 0;
  const hasTransition = parseCssTime(style.transitionDuration) > 0;

  if (hasAnimation || hasTransition) {
    return true;
  }

  if (typeof element.getAnimations !== "function") {
    return false;
  }

  try {
    return element.getAnimations({ subtree: true }).some((animation) => {
      const target = animation.effect && animation.effect.target;
      const targetElement =
        target instanceof Element
          ? target
          : target && target.element instanceof Element
            ? target.element
            : null;

      return !targetElement || !isExtensionElement(targetElement);
    });
  } catch (_error) {
    return false;
  }
}

function parseCssTime(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .reduce((max, part) => {
      if (part.endsWith("ms")) {
        return Math.max(max, Number.parseFloat(part) || 0);
      }

      if (part.endsWith("s")) {
        return Math.max(max, (Number.parseFloat(part) || 0) * 1000);
      }

      return max;
    }, 0);
}

function isPageAllowed(settings) {
  if (!settings || !settings.enabled) {
    return false;
  }

  if (isSensitivePage()) {
    return false;
  }

  return !isDomainDisabled(location.hostname, settings.disabledDomains);
}

function isSensitivePage() {
  const host = location.hostname.toLowerCase();
  const normalizedHost = stripWww(host);

  if (
    SENSITIVE_DOMAINS.some((domain) => {
      return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
    })
  ) {
    return true;
  }

  if (SENSITIVE_HOST_WORDS.some((word) => normalizedHost.includes(word))) {
    return true;
  }

  if (SENSITIVE_PATH_RE.test(location.pathname)) {
    return true;
  }

  if (document.body && document.body.isContentEditable) {
    return true;
  }

  return hasVisiblePasswordInput();
}

function hasVisiblePasswordInput() {
  return Array.from(document.querySelectorAll("input[type='password']")).some(
    (input) => {
      if (!(input instanceof HTMLElement)) {
        return false;
      }

      if (input.disabled || input.type === "hidden") {
        return false;
      }

      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number.parseFloat(style.opacity || "1") > 0
      );
    }
  );
}

function isDomainDisabled(hostname, disabledDomains) {
  const host = stripWww(hostname.toLowerCase());

  return disabledDomains.some((domain) => {
    const normalized = normalizeDomain(domain);
    return normalized && (host === normalized || host.endsWith(`.${normalized}`));
  });
}

function normalizeDomain(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();

  if (!raw) {
    return "";
  }

  try {
    return stripWww(new URL(raw.includes("://") ? raw : `https://${raw}`).hostname);
  } catch (_error) {
    return stripWww(raw.split("/")[0]);
  }
}

function stripWww(hostname) {
  return hostname.replace(/^www\./, "");
}
