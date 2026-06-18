function replaceCandidate(element) {
  if (!safeToReplace(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const minHeight = Math.max(48, Math.round(rect.height));
  const slot = createReplacementSlot(element, rect);
  const surfaceKey = createSurfaceKey(element, rect);
  const preservesSiteChildren = slot === element;

  slot.dataset.attentionRedirectorReplaced = "true";
  slot.dataset.attentionRedirectorSurfaceKey = surfaceKey;
  slot.dataset.attentionRedirectorWidth = String(Math.round(rect.width));
  slot.dataset.attentionRedirectorHeight = String(Math.round(rect.height));
  slot.classList.add("attention-redirector-slot");
  slot.classList.toggle(
    "attention-redirector-slot--preserve-children",
    preservesSiteChildren
  );
  slot.setAttribute("aria-label", "Attention Redirector replacement");
  slot.style.minHeight = `${minHeight}px`;

  if (rect.width > 0 && rect.width < 420) {
    slot.classList.add("attention-redirector-slot--narrow");
  }

  if (rect.height < 90) {
    slot.classList.add("attention-redirector-slot--short");
  }

  renderReplacementSlot(slot);
  return true;
}

function applySettingsToReplacedSlots() {
  document.querySelectorAll(".attention-redirector-slot").forEach((slot) => {
    if (slot instanceof HTMLElement) {
      renderReplacementSlot(slot);
    }
  });
}

function renderReplacementSlot(slot) {
  const width = Number.parseFloat(slot.dataset.attentionRedirectorWidth || "0");
  const height = Number.parseFloat(slot.dataset.attentionRedirectorHeight || "0");
  const rect = {
    width: width || slot.getBoundingClientRect().width,
    height: height || slot.getBoundingClientRect().height
  };
  const surfaceKey =
    slot.dataset.attentionRedirectorSurfaceKey ||
    createSurfaceKey(slot, slot.getBoundingClientRect());
  const existingGuard = state.replacementGuards.get(slot);
  const preservesSiteChildren = slot.classList.contains(
    "attention-redirector-slot--preserve-children"
  );

  if (!isPageAllowed(state.settings) || !shouldVisualizeSurface(surfaceKey)) {
    if (existingGuard) {
      existingGuard.disconnect();
      state.replacementGuards.delete(slot);
    }
    slot.dataset.attentionRedirectorPresentation = "clean";
    removeReplacementCards(slot);
    slot.style.display = "none";
    return;
  }

  slot.style.removeProperty("display");
  slot.dataset.attentionRedirectorPresentation = "ambient";
  const card = buildCard(createCardModel(surfaceKey), rect);
  removeReplacementCards(slot);
  if (preservesSiteChildren) {
    slot.append(card);
  } else {
    slot.replaceChildren(card);
  }
  observeCardMotion(card);
  installReplacementGuard(slot, card);
}

function removeReplacementCards(slot) {
  slot
    .querySelectorAll(":scope > .attention-redirector-card")
    .forEach((card) => {
      if (state.motionObserver) {
        state.motionObserver.unobserve(card);
      }
      card.remove();
    });
}

function observeCardMotion(card) {
  if (
    state.settings.reducedMotion === "still" ||
    typeof IntersectionObserver !== "function"
  ) {
    return;
  }

  if (!state.motionObserver) {
    state.motionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle(
            "attention-redirector-card--motion-paused",
            !entry.isIntersecting
          );
        });
      },
      {
        rootMargin: "700px 0px",
        threshold: 0
      }
    );
  }

  card.classList.add("attention-redirector-card--motion-paused");
  state.motionObserver.observe(card);
}

function shouldVisualizeSurface(surfaceKey) {
  const presence = state.settings.visualPresence;
  if (presence <= 0) {
    return false;
  }
  if (presence >= 10) {
    return true;
  }
  return hashString(surfaceKey) % 10 < presence;
}

function createSurfaceKey(element, rect) {
  return [
    location.hostname,
    location.pathname,
    getElementSignature(element),
    Math.round(rect.left || 0),
    Math.round(rect.top || 0),
    Math.round(rect.width || 0),
    Math.round(rect.height || 0)
  ].join(":");
}

function installReplacementGuard(slot, card) {
  const existingGuard = state.replacementGuards.get(slot);
  if (existingGuard) {
    existingGuard.disconnect();
  }

  const preservesSiteChildren = slot.classList.contains(
    "attention-redirector-slot--preserve-children"
  );
  let restoring = false;
  const restoreCard = () => {
    if (restoring || !slot.isConnected || slot.style.display === "none") {
      return;
    }

    const cardIsPresent = card.parentElement === slot;
    const cardIsOnlyChild =
      cardIsPresent &&
      slot.children.length === 1 &&
      slot.firstElementChild === card;
    const markersArePresent =
      slot.classList.contains("attention-redirector-slot") &&
      (!preservesSiteChildren ||
        slot.classList.contains(
          "attention-redirector-slot--preserve-children"
        ));
    if (
      markersArePresent &&
      (preservesSiteChildren ? cardIsPresent : cardIsOnlyChild)
    ) {
      return;
    }

    restoring = true;
    slot.dataset.attentionRedirectorReplaced = "true";
    slot.classList.add("attention-redirector-slot");
    slot.classList.toggle(
      "attention-redirector-slot--preserve-children",
      preservesSiteChildren
    );
    if (preservesSiteChildren) {
      if (!cardIsPresent) {
        removeReplacementCards(slot);
        slot.append(card);
      }
    } else {
      slot.replaceChildren(card);
    }
    restoring = false;
  };

  const observer = new MutationObserver(restoreCard);
  observer.observe(slot, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: false
  });
  state.replacementGuards.set(slot, observer);
}

function createReplacementSlot(element, rect) {
  if (!element.matches("iframe,img,embed,amp-ad")) {
    return element;
  }

  const wrapper = document.createElement("div");
  wrapper.style.width = `${Math.max(120, Math.round(rect.width))}px`;
  wrapper.style.maxWidth = "100%";
  wrapper.style.height = `${Math.max(40, Math.round(rect.height))}px`;
  element.replaceWith(wrapper);
  return wrapper;
}

function buildCard(cardModel, rect) {
  const card = document.createElement("div");
  card.className = "attention-redirector-card";
  card.dataset.mode = cardModel.mode;
  card.dataset.ambientVariant = "tide";
  card.style.setProperty("--ar-motion-delay", `${cardModel.motionDelay}s`);
  card.classList.toggle(
    "attention-redirector-card--still",
    state.settings.reducedMotion === "still"
  );
  card.setAttribute("role", "group");
  card.setAttribute(
    "aria-label",
    cardModel.mode === "anchor"
      ? `Attention anchor: ${cardModel.body}`
      : "Quiet attention replacement"
  );

  if (rect.width < 260 || rect.height < 110) {
    card.classList.add("attention-redirector-card--compact");
  }

  const hideButton = document.createElement("button");
  hideButton.type = "button";
  hideButton.className = "attention-redirector-card__hide";
  hideButton.textContent = "×";
  hideButton.setAttribute("aria-label", "Hide this Attention Redirector card");
  hideButton.addEventListener("click", () => {
    const slot = card.closest(".attention-redirector-slot");
    if (slot) {
      slot.style.display = "none";
    }
  });

  card.append(hideButton);

  if (cardModel.mode === "anchor") {
    const body = document.createElement("div");
    body.className = "attention-redirector-card__body";
    body.textContent = cardModel.body;
    card.append(body);
  }

  return card;
}

function createCardModel(surfaceKey) {
  const sequence = state.cardSequence;
  state.cardSequence += 1;

  return {
    mode: state.settings.mode,
    body: state.settings.anchorNote,
    motionDelay: -(((hashString(surfaceKey) + sequence) % 6) * 5)
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function getIdentifierText(element) {
  const parts = [
    element.id,
    element.className,
    element.getAttribute("aria-label"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-ad-slot"),
    element.getAttribute("data-ad-client"),
    element.localName
  ];

  return parts.filter(Boolean).join(" ").toLowerCase();
}

function getElementSignature(element) {
  const tag = element.localName || "element";
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList || [])
    .filter((className) => !className.startsWith("attention-redirector"))
    .slice(0, 6)
    .map((className) => `.${className}`)
    .join("");

  return `${tag}${id}${classes}`;
}

function getAncestry(element) {
  const ancestry = [];
  let current = element;
  let depth = 0;

  while (current && current !== document.body && depth < 6) {
    if (current instanceof HTMLElement) {
      ancestry.unshift(getElementSignature(current));
    }
    current = current.parentElement;
    depth += 1;
  }

  return ancestry;
}

function getShortLabelText(element) {
  const ownText = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(" ");

  const labelText = [
    ownText,
    element.getAttribute("aria-label"),
    element.getAttribute("title")
  ]
    .filter(Boolean)
    .join(" ");

  if (labelText.trim().length > 0) {
    return labelText.slice(0, 240);
  }

  return element.textContent ? element.textContent.trim().slice(0, 240) : "";
}

function hasAdLikeSource(element) {
  const srcValues = Array.from(
    element.querySelectorAll("iframe,img,embed,source")
  )
    .map((node) => {
      return [
        node.getAttribute("src"),
        node.getAttribute("data-src"),
        node.getAttribute("srcdoc")
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join(" ");

  const ownSrc = [
    element.getAttribute("src"),
    element.getAttribute("data-src"),
    element.getAttribute("srcdoc")
  ]
    .filter(Boolean)
    .join(" ");

  return AD_SOURCE_RE.test(`${ownSrc} ${srcValues}`);
}

function getSourceValues(element) {
  const nodes = [element, ...Array.from(element.querySelectorAll("iframe,img,embed,source"))];
  const values = [];

  nodes.slice(0, 12).forEach((node) => {
    ["src", "data-src", "srcdoc"].forEach((attribute) => {
      const value = node.getAttribute(attribute);
      if (value) {
        values.push(truncateMiddle(value.trim(), 180));
      }
    });
  });

  return Array.from(new Set(values)).slice(0, 8);
}

function truncateMiddle(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  const half = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, half)}...${value.slice(-half)}`;
}

function hasUnsafeIdentifier(element) {
  return UNSAFE_IDENTIFIER_RE.test(getIdentifierText(element));
}

function hasHardUnsafeIdentifier(element) {
  return HARD_UNSAFE_IDENTIFIER_RE.test(getIdentifierText(element));
}

function hasSoftUnsafeIdentifier(element) {
  return SOFT_UNSAFE_IDENTIFIER_RE.test(getIdentifierText(element));
}

function hasUnsafeIdentifierInAncestors(element) {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (UNSAFE_IDENTIFIER_RE.test(getIdentifierText(current))) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function hasHardUnsafeIdentifierInAncestors(element) {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (HARD_UNSAFE_IDENTIFIER_RE.test(getIdentifierText(current))) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function hasSoftUnsafeIdentifierInAncestors(element) {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (SOFT_UNSAFE_IDENTIFIER_RE.test(getIdentifierText(current))) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function hasHardUnsafeAncestor(element) {
  return Boolean(element.closest(HARD_UNSAFE_ANCESTOR_SELECTOR));
}

function hasSoftUnsafeAncestor(element) {
  return Boolean(element.closest(SOFT_UNSAFE_ANCESTOR_SELECTOR));
}

function isVisibleRect(rect) {
  return rect.width >= 120 && rect.height >= 40;
}

function isSmallContainer(rect) {
  return rect.width <= 420 || rect.height <= 320;
}

function isTooLargeForMvp(rect) {
  const viewportArea = window.innerWidth * window.innerHeight;
  const area = rect.width * rect.height;

  if (area > viewportArea * 0.35) {
    return true;
  }

  if (rect.width > window.innerWidth * 0.94 && rect.height > 260) {
    return true;
  }

  return false;
}

function canReplaceExplicitLargeAd(element, rect) {
  return hasStrongAdSignal(element) && !isTooLargeForExplicitAd(rect);
}

function isTooLargeForExplicitAd(rect) {
  const viewportArea = window.innerWidth * window.innerHeight;
  const area = rect.width * rect.height;

  if (area > viewportArea * 0.9) {
    return true;
  }

  if (rect.width > window.innerWidth * 0.98 && rect.height > window.innerHeight * 0.85) {
    return true;
  }

  if (rect.height > Math.max(760, window.innerHeight * 1.2)) {
    return true;
  }

  return false;
}

function isTooLargeForInspector(rect, element) {
  const viewportArea = window.innerWidth * window.innerHeight;
  const area = rect.width * rect.height;

  if (area <= viewportArea * 0.85) {
    return false;
  }

  if (!element) {
    return true;
  }

  const style = window.getComputedStyle(element);
  return style.position !== "fixed" && style.position !== "sticky";
}

function isCommonAdSize(rect) {
  return COMMON_AD_SIZES.some(([width, height]) => {
    const widthDelta = Math.abs(rect.width - width);
    const heightDelta = Math.abs(rect.height - height);
    return widthDelta <= 32 && heightDelta <= 28;
  });
}

function isSidebarElement(element) {
  return Boolean(
    element.closest("aside,[role='complementary']") ||
      /(^|[\s_.:-])(sidebar|rail|right-column|rightcol)([\s_.:-]|$)/i.test(
        getIdentifierText(element.parentElement || element)
      )
  );
}

function isLikelyHeroBanner(element) {
  const identifiers = getIdentifierText(element);
  const rect = element.getBoundingClientRect();

  return (
    /(^|[\s_.:-])(hero|masthead|site-banner|brand-banner)([\s_.:-]|$)/i.test(
      identifiers
    ) ||
    (rect.width > window.innerWidth * 0.75 && rect.height > 180)
  );
}

function hasSimilarRect(child, parent) {
  const childRect = child.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();

  if (!isVisibleRect(childRect) || !isVisibleRect(parentRect)) {
    return false;
  }

  return (
    Math.abs(childRect.width - parentRect.width) <= 48 &&
    Math.abs(childRect.height - parentRect.height) <= 48
  );
}

function getArea(element) {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
}
