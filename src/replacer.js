// Returns the prepared slot rather than rendering it. The note a slot shows
// depends on where its neighbours sit, which is only knowable once the whole
// batch exists, so the scan claims every slot first and renders afterwards.
function replaceCandidate(element) {
  if (!safeToReplace(element)) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const minHeight = Math.max(48, Math.round(rect.height));
  const slot = createReplacementSlot(element, rect);
  const preservesSiteChildren = slot === element;
  const isFixedOverlay = window.getComputedStyle(element).position === "fixed";
  const collapseOversizedCosmetic = canCollapseOversizedDomainCosmetic(element, rect);

  ensureReplacementRootStyles(slot);
  slot.dataset.attentionRedirectorReplaced = "true";
  slot.dataset.attentionRedirectorWidth = String(Math.round(rect.width));
  slot.dataset.attentionRedirectorHeight = String(Math.round(rect.height));
  // Capture overlay status before slot classes apply position overrides
  // (--preserve-children forces position: relative on the element).
  if (isFixedOverlay) {
    slot.dataset.attentionRedirectorOverlay = "true";
  }
  if (collapseOversizedCosmetic) {
    slot.dataset.attentionRedirectorCollapse = "oversized-cosmetic";
  }
  slot.classList.add("attention-redirector-slot");
  slot.classList.toggle(
    "attention-redirector-slot--preserve-children",
    preservesSiteChildren
  );
  slot.setAttribute("aria-label", "Notturn replacement");
  slot.style.minHeight = `${minHeight}px`;

  if (rect.width > 0 && rect.width < 420) {
    slot.classList.add("attention-redirector-slot--narrow");
  }

  if (rect.height < 90) {
    slot.classList.add("attention-redirector-slot--short");
  }

  if (rect.height >= 320 && rect.height > rect.width * 1.8) {
    slot.classList.add("attention-redirector-slot--tall");
  }

  return slot;
}

function renderInReadingOrder(slots) {
  slots
    .map((slot) => ({ slot, top: slot.getBoundingClientRect().top }))
    .sort((a, b) => a.top - b.top)
    .forEach(({ slot }) => renderReplacementSlot(slot));
}

function applySettingsToReplacedSlots() {
  queryAllScanRoots(".attention-redirector-slot").forEach((slot) => {
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
  const existingGuard = state.replacementGuards.get(slot);
  const preservesSiteChildren = slot.classList.contains(
    "attention-redirector-slot--preserve-children"
  );

  // Overlay ads are hidden, never carded: a card in a fixed overlay or
  // viewport takeover occupies the screen exactly like the ad did. Cards are
  // reserved for in-flow slots, where they preserve the page's layout.
  const isOverlaySlot =
    slot.dataset.attentionRedirectorReason === FULL_PAGE_TAKEOVER_REASON ||
    slot.dataset.attentionRedirectorOverlay === "true" ||
    window.getComputedStyle(slot).position === "fixed";
  const shouldCollapseSlot =
    isOverlaySlot ||
    slot.dataset.attentionRedirectorCollapse === "oversized-cosmetic";

  const pageAllowed = isPageAllowed(state.settings);
  // A slot becomes a card only if the user holds something to put in it. With no
  // note there is nothing to draw, so the surface collapses and the page reflows:
  // an empty note list is how you ask for a plain blocker.
  const hasNote = state.settings.anchorNotes.length > 0;
  if (!pageAllowed || shouldCollapseSlot || !hasNote) {
    if (existingGuard) {
      existingGuard.disconnect();
      state.replacementGuards.delete(slot);
    }
    slot.dataset.attentionRedirectorPresentation = "clean";
    removeReplacementCards(slot);
    // Collapse the slot out of flow — so the page reflows like an ad blocker —
    // when the user holds no note to show here, or it is an overlay/oversized
    // cosmetic. When the extension or site is simply turned off we only hide, so
    // a refresh restores the original layout without us having removed boxes.
    const collapse = shouldCollapseSlot || (pageAllowed && !hasNote);
    hideReplacementSlot(slot, { collapse });
    return;
  }

  slot.style.removeProperty("display");
  slot.style.removeProperty("visibility");
  slot.style.removeProperty("pointer-events");

  // Our own hiding is inline, so it is gone by this line and what remains is the
  // site's. A slot the site keeps hidden has no attention to redirect: carding it
  // puts a note nobody can read into a gap nobody was meant to see, and forcing
  // the card visible would fill a blank the page deliberately left blank.
  if (window.getComputedStyle(slot).visibility === "hidden") {
    removeReplacementCards(slot);
    return;
  }

  slot.dataset.attentionRedirectorPresentation = "ambient";
  const card = buildCard(createCardModel(slot), rect, slot);
  removeReplacementCards(slot);
  if (preservesSiteChildren) {
    slot.append(card);
  } else {
    slot.replaceChildren(card);
  }
  fitCardText(card);
  installReplacementGuard(slot, card);
}

function hideReplacementSlot(slot, { collapse = false } = {}) {
  if (collapse) {
    slot.style.setProperty("display", "none", "important");
    slot.style.setProperty("min-height", "0", "important");
    slot.style.setProperty("height", "0", "important");
    slot.style.setProperty("padding", "0", "important");
    slot.style.setProperty("margin", "0", "important");
    slot.style.setProperty("border", "0", "important");
    slot.style.setProperty("pointer-events", "none", "important");
    return;
  }

  slot.style.removeProperty("display");
  slot.style.setProperty("visibility", "hidden", "important");
  slot.style.setProperty("pointer-events", "none", "important");
}

function ensureReplacementRootStyles(slot) {
  const root = getContainingOpenShadowRoot(slot);
  if (root) {
    ensureShadowRootStyles(root);
  }
}

function removeReplacementCards(slot) {
  slot
    .querySelectorAll(":scope > .attention-redirector-card")
    .forEach((card) => card.remove());
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

// Every card rule in content.css is one class deep, so any site rule of the
// shape `.their-wrapper div` outranks it on specificity — !important does not
// help, because the site's declaration is important too and specificity breaks
// the tie. Forbes ships `._8mPtn1sX div { position: absolute !important; inset:
// 0 !important }` on its ad containers, which pulled the note out of the card's
// padding box and out of flex centring, and left fitCardText measuring a body
// stretched to the full card. Specificity is a race the host page can always
// win, so the few properties that decide where the note sits are pinned inline,
// which no author rule of any specificity outranks.
function pinAgainstHostCss(element, declarations) {
  Object.entries(declarations).forEach(([property, value]) => {
    element.style.setProperty(property, value, "important");
  });
}

function buildCard(cardModel, rect, slot) {
  const card = document.createElement("div");
  card.className = "attention-redirector-card";
  card.dataset.hostTone = detectHostTone(slot);
  const preservesSiteChildren = slot.classList.contains(
    "attention-redirector-slot--preserve-children"
  );
  pinAgainstHostCss(card, {
    position: preservesSiteChildren ? "absolute" : "relative",
    inset: preservesSiteChildren ? "0" : "auto",
    display: "flex",
    float: "none",
    transform: "none"
  });
  // Provisional, so the attribute always exists. fitCardText decides it for
  // real once the note has been measured against the box, which happens in this
  // same task — the card never paints holding this value.
  card.dataset.noteLines = "few";
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", `Attention anchor: ${cardModel.body}`);

  if (rect.width < 260 || rect.height < 110) {
    card.classList.add("attention-redirector-card--compact");
  }

  const w = rect.width || 0;
  const h = rect.height || 0;
  if (w && h) {
    const pad = Math.round(Math.min(Math.max(Math.min(w, h) * 0.1, 10), 48));
    card.style.setProperty("--ar-card-pad", `${pad}px`);
    applyCardTypeScale(card, cardFontCeiling(rect, countWords(cardModel.body)));
  }

  const hideButton = document.createElement("button");
  hideButton.type = "button";
  hideButton.className = "attention-redirector-card__hide";
  hideButton.textContent = "×";
  hideButton.setAttribute("aria-label", "Hide this Notturn card");
  hideButton.addEventListener("click", () => {
    const slot = card.closest(".attention-redirector-slot");
    if (slot) {
      slot.style.display = "none";
    }
  });

  card.append(hideButton);

  const body = document.createElement("div");
  body.className = "attention-redirector-card__body";
  body.textContent = cardModel.body;
  pinAgainstHostCss(body, {
    position: "relative",
    inset: "auto",
    // -webkit-box is what carries the line clamp; blockifying the body by
    // positioning it also silently drops the clamp.
    display: "-webkit-box",
    margin: "0",
    float: "none",
    transform: "none"
  });
  card.append(body);

  return card;
}

// Below this the note is technically present and practically unreadable, so the
// card stops shrinking and clamps instead. An honest ellipsis beats microscopic
// text that only looks like it fits.
const CARD_FONT_FLOOR = 13;

// state.shadowStyleRoots is a WeakSet and cannot be walked, so the roots are
// collected the same way the scanner finds them.
function refitAllCards() {
  const roots = [document, ...collectOpenShadowRoots(document)];
  roots.forEach((root) => {
    root
      .querySelectorAll(".attention-redirector-card")
      .forEach((card) => fitCardText(card));
  });
}

function countWords(note) {
  const trimmed = String(note || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// The number of ancestors worth asking. A slot whose whole chain up to this
// depth is transparent is sitting on the page background, and the OS preference
// is a better guess than any of the transparent boxes in between.
const HOST_TONE_MAX_DEPTH = 12;

// Relative luminance below this reads as a dark surface. Set below the midpoint
// on purpose: a card that picks the dark variant on a mid-grey host is merely a
// little flat, while one that picks light on a near-black host is a lit panel in
// the corner of the eye.
const HOST_TONE_DARK_LUMINANCE = 0.35;

// The card is the same colour on every site, but sites are not. Walk up from the
// slot for the first background that is actually painted, and take the side of
// the pair that sits in it quietly.
function detectHostTone(slot) {
  let element = slot instanceof Element ? slot : null;
  let depth = 0;

  while (element && depth < HOST_TONE_MAX_DEPTH) {
    const luminance = opaqueBackgroundLuminance(element);
    if (luminance !== null) {
      return luminance < HOST_TONE_DARK_LUMINANCE ? "dark" : "light";
    }
    // parentElement is null at the top of a shadow tree, so a slot inside one
    // would otherwise fall through to the OS preference having never seen the
    // page it is sitting on. Step to the host and keep walking.
    element = element.parentElement || getContainingOpenShadowRoot(element)?.host || null;
    depth += 1;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function opaqueBackgroundLuminance(element) {
  const parsed = window
    .getComputedStyle(element)
    .backgroundColor.match(/[\d.]+/g);
  if (!parsed || parsed.length < 3) {
    return null;
  }
  // A transparent background is not this element's colour, it is whatever is
  // behind it, so the walk has to keep going.
  if (parsed.length > 3 && Number(parsed[3]) === 0) {
    return null;
  }

  const [r, g, b] = parsed.slice(0, 3).map((value) => {
    const channel = Number(value) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Leading and tracking are a function of size, not of the card. A note set at
// 44px wants the lines close and the letters pulled in; the same note at 14px
// wants neither, and applying the display setting to it makes it look broken.
function cardLineHeight(size) {
  return size >= 30 ? 1.12 : size >= 20 ? 1.2 : 1.3;
}

function cardTracking(size) {
  return size >= 28 ? "-0.022em" : size >= 18 ? "-0.012em" : "0em";
}

// Space Grotesk's own line box is about this tall, so any leading tighter than
// it leaves ascenders and descenders hanging outside the line, where the clamp's
// overflow:hidden shaves them.
const CARD_LINE_BOX_EM = 1.24;

// Give that overhang back as padding on the body rather than loosening the
// leading, which is the design's and not the metric's to choose. Loose leading
// needs none of it, and on a 50px banner the room is a whole line of text.
function cardInkRoom(size) {
  return Math.max(0, (CARD_LINE_BOX_EM - cardLineHeight(size)) / 2);
}

function applyCardTypeScale(card, size) {
  card.style.setProperty("--ar-card-font", `${size}px`);
  card.style.setProperty("--ar-card-lh", String(cardLineHeight(size)));
  card.style.setProperty("--ar-card-track", cardTracking(size));
  card.style.setProperty("--ar-card-ink", `${cardInkRoom(size)}em`);
}

// The size a card would like to use if the note were short, by slot shape. The
// fit pass only ever comes down from here, so a short note in a big slot still
// renders at the size it always did.
function cardFontCeiling(rect, wordCount) {
  const w = rect.width || 0;
  const h = rect.height || 0;

  if (!(w && h)) {
    return 44;
  }

  const tall = h >= 320 && h > w * 1.8;
  let ceiling;
  if (tall) {
    ceiling = Math.round(Math.min(Math.max(w * 0.13, 18), 30));
  } else if (w < 420) {
    ceiling = 20;
  } else if (h < 90) {
    ceiling = 15;
  } else if (w < 260 || h < 110) {
    ceiling = 17;
  } else {
    ceiling = Math.round(Math.min(Math.max(h * 0.22, 18), 44));
  }

  // A sentence set at display size in a wide, shallow box reads as a headline
  // shouting across the page, which is the thing the card exists to stop doing.
  // A word or two is an object rather than a sentence and keeps the full size.
  if (wordCount > 2 && ceiling > 24 && w < 728 && !tall) {
    ceiling = Math.round(ceiling * 0.65);
  }
  return ceiling;
}

// Sizing text from the slot's height alone cannot know how much text there is,
// so a long note was silently clamped away — the card looked fine and the
// sentence was missing its ending. Measure the rendered note against the box it
// has to live in and step the size down until it fits, then set the line count
// from what actually fits so a note that hits the floor ends in an ellipsis
// rather than a shaved half-line.
function fitCardText(card) {
  const body = card.querySelector(".attention-redirector-card__body");
  if (!body) {
    return;
  }

  const style = window.getComputedStyle(card);
  const availableWidth =
    card.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  const availableHeight =
    card.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom);
  if (!(availableWidth > 0 && availableHeight > 0)) {
    return;
  }

  // Unclamp while measuring, or the body reports the size the clamp already cut
  // it to instead of the size the note wants.
  card.style.setProperty("--ar-card-lines", "999");

  const ceiling = Math.round(
    parseFloat(card.style.getPropertyValue("--ar-card-font")) || 44
  );
  const floor = Math.min(CARD_FONT_FLOOR, ceiling);

  // The note has to fit in whole lines, because whole lines are what the clamp
  // will keep. Measuring against the raw box height instead lets a size through
  // whose last line the clamp then cuts.
  const measure = (size) => {
    applyCardTypeScale(card, size);
    // Computed from the same rule the stylesheet just took, rather than read
    // back off the element: reading forces a style flush on every one of the
    // seven probes this search makes.
    const lineHeight = size * cardLineHeight(size);
    // The ink room is padding on the body, so it comes out of the card before
    // the lines get their share. Budgeting the full height instead lets a line
    // through that then pushes the whole body outside the card it clips against.
    const ink = 2 * size * cardInkRoom(size);
    const lines = Math.max(1, Math.floor((availableHeight - ink) / lineHeight));
    return {
      lines,
      fits:
        // scrollHeight counts the padding, so the budget it is checked against
        // has to as well.
        body.scrollHeight <= lines * lineHeight + ink + 1 &&
        body.scrollWidth <= availableWidth + 1
    };
  };

  let best = null;
  let bestLines = 1;
  const atCeiling = measure(ceiling);

  if (atCeiling.fits) {
    best = ceiling;
    bestLines = atCeiling.lines;
  } else {
    let low = floor;
    let high = ceiling - 1;
    // Six halvings resolve the whole range to the nearest pixel.
    for (let step = 0; step < 6 && low <= high; step += 1) {
      const middle = Math.floor((low + high) / 2);
      const result = measure(middle);
      if (result.fits) {
        best = middle;
        bestLines = result.lines;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
  }

  if (best === null) {
    // Longer than the slot can hold at a readable size. Render at the floor and
    // let the clamp end it with an ellipsis.
    best = floor;
    bestLines = measure(floor).lines;
  }

  applyCardTypeScale(card, best);

  // Alignment follows the number of lines the reader actually meets, not the
  // note's word count. Word count cannot see the box: three words set to one
  // line in a leaderboard and to three in a 160px column, and both want the
  // middle of the card. Past three lines the note is a block read downward, and
  // a straight left edge is what makes it readable. Counted here because this is
  // where the note has been measured against the real box, and read before the
  // clamp goes back on, then capped by it — what matters is the lines on screen.
  const lineHeight = best * cardLineHeight(best);
  const ink = 2 * best * cardInkRoom(best);
  const shownLines = Math.min(
    Math.max(1, Math.round((body.scrollHeight - ink) / lineHeight)),
    bestLines
  );
  card.style.setProperty("--ar-card-lines", String(bestLines));
  card.dataset.noteLines = shownLines > 3 ? "many" : "few";
}

function createCardModel(slot) {
  return { body: selectAnchorNote(slot) };
}

// Hashing each slot independently gave neighbours no reason to differ: four
// cards on a Forbes article drew three notes out of five, two of them running.
// Reading the same sentence twice in a row is what makes a refrain read as a
// stuck page rather than a calm one, so the notes are dealt in a rotation that
// spends the list before repeating any of it.
//
// The number is drawn here rather than when the slot is claimed, because a
// claimed slot does not always become a card: overlays and oversized cosmetics
// collapse instead. Numbering those too left holes in the rotation, and a hole
// as wide as the note list puts the same sentence on two cards running — which
// is exactly the symptom, reappearing through the fix meant to remove it.
//
// The number sticks to the slot so that re-rendering, which happens on every
// settings change, does not change the note under a reader looking at it. The
// page's own key only chooses where the rotation starts, so two pages do not
// both open on the first note.
function selectAnchorNote(slot) {
  const notes = state.settings.anchorNotes;
  const stored = Number.parseInt(slot.dataset.attentionRedirectorNote, 10);
  if (!Number.isInteger(stored)) {
    if (state.noteCursor === null) {
      state.noteCursor = hashString(location.hostname + location.pathname);
    }
    slot.dataset.attentionRedirectorNote = String(state.noteCursor);
    state.noteCursor += 1;
  }

  return notes[
    Number.parseInt(slot.dataset.attentionRedirectorNote, 10) % notes.length
  ];
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
    element.getAttribute("data-testid"),
    element.getAttribute("data-ad-slot"),
    element.getAttribute("data-ad-client"),
    element.localName
  ];

  return parts.filter(Boolean).join(" ").toLowerCase();
}

// aria-label is human prose, not a machine identifier: an app describing ads
// (e.g. "Ads conversion diagnostic") must never be condemned by it, but it may
// still veto a replacement as unsafe.
function getSafetyIdentifierText(element) {
  const ariaLabel = element.getAttribute("aria-label");
  return ariaLabel
    ? `${getIdentifierText(element)} ${ariaLabel.toLowerCase()}`
    : getIdentifierText(element);
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

function getOwnText(element) {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(" ");
}

function isAdLabelString(value) {
  if (!value) {
    return false;
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text || text.length > AD_LABEL_MAX_LENGTH) {
    return false;
  }

  return AD_LABEL_RE.test(text);
}

function hasAdLabel(element) {
  if (
    isAdLabelString(getOwnText(element)) ||
    isAdLabelString(element.getAttribute("aria-label")) ||
    isAdLabelString(element.getAttribute("title"))
  ) {
    return true;
  }

  // A label-only leaf counts only when the container has little other text.
  // Long text blocks that happen to contain a standalone "Реклама"/"Sponsored"
  // word (icon legends, encyclopedia definitions) are editorial content.
  const totalText = String(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  if (totalText.length > 120) {
    return false;
  }

  // A container holding nothing but the caption is self-identifying, whatever
  // element the caption sits in. Without this the leaf scan below decides, and
  // it cannot see a caption written as <p>Advertisement</p> or as a link, which
  // is how a slot survives with its label still showing. The label pattern is
  // anchored, so this matches only text that is the caption and nothing else.
  if (isAdLabelString(totalText)) {
    return true;
  }

  const descendants = element.querySelectorAll(
    "span,div,p,small,b,strong,em,i,h4,h5,h6,figcaption,label"
  );
  let checked = 0;

  for (const node of descendants) {
    if (checked >= 40) {
      break;
    }
    checked += 1;

    // A leaf inside a link is site chrome ("Advertising" nav links) and a leaf
    // inside a paragraph is prose (the bolded label word in a definition).
    // Neither is a slot badge. The paragraph itself is the exception: a <p>
    // whose own text is the whole caption is how sites mark a slot, and
    // skipping it is what left labelled banners standing with their caption
    // showing above a reserved gap. The 120-character cap above keeps this
    // away from anything with real content around the badge.
    if (node.parentElement && node.parentElement.closest("a,p")) {
      continue;
    }

    if (isAdLabelString(getOwnText(node))) {
      return true;
    }
  }

  return false;
}

function isBareLinkedMediaSlot(element) {
  const children = Array.from(element.children).filter(
    (child) => !child.matches("script,style,noscript")
  );
  if (children.length !== 1 || !children[0].matches("a[href]")) {
    return false;
  }

  const link = children[0];
  if (link.textContent.trim()) {
    return false;
  }

  const media = link.querySelector("img,embed,picture,iframe");
  if (!media) {
    return false;
  }

  return hasSimilarRect(media, element);
}

function hasNonAdIframe(element) {
  return Array.from(element.querySelectorAll("iframe"))
    .slice(0, 8)
    .some((frame) => {
      const src =
        frame.getAttribute("src") || frame.getAttribute("data-src") || "";
      if (!src || /^(about:|javascript:)/i.test(src)) {
        return false;
      }
      return !AD_SOURCE_RE.test(src);
    });
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

function hasAdScriptEvidence(element) {
  return AD_SCRIPT_TEXT_RE.test(getAdScriptText(element));
}

function hasBoundedAdScriptEvidence(element) {
  if (!hasAdScriptEvidence(element)) {
    return false;
  }

  return isBoundedAdContainerRect(element.getBoundingClientRect());
}

function getAdScriptText(element) {
  const scripts = element.matches("script")
    ? [element]
    : Array.from(element.querySelectorAll("script")).slice(0, 4);

  return scripts
    .map((script) => script.textContent || "")
    .join(" ")
    .slice(0, 2200);
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

function hasExplicitAdDataAttribute(element) {
  return String(element.getAttribute("data-ad") || "").toLowerCase() === "true";
}

function truncateMiddle(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  const half = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, half)}...${value.slice(-half)}`;
}

function hasUnsafeIdentifier(element) {
  return UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(element));
}

function hasHardUnsafeIdentifier(element) {
  return HARD_UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(element));
}

function hasSoftUnsafeIdentifier(element) {
  return SOFT_UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(element));
}

function hasUnsafeIdentifierInAncestors(element) {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(current))) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function hasHardUnsafeIdentifierInAncestors(element) {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (HARD_UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(current))) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function hasSoftUnsafeIdentifierInAncestors(element) {
  let current = element.parentElement;

  while (current && current !== document.body) {
    if (SOFT_UNSAFE_IDENTIFIER_RE.test(getSafetyIdentifierText(current))) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function hasHardUnsafeAncestor(element) {
  return Boolean(closestAcrossRoots(element, HARD_UNSAFE_ANCESTOR_SELECTOR));
}

function hasReplacedAncestor(element) {
  return Boolean(
    element.parentElement &&
      closestAcrossRoots(
        element.parentElement,
        "[data-attention-redirector-replaced='true']"
      )
  );
}

function containsReplacedSlot(element) {
  return Boolean(
    element.querySelector("[data-attention-redirector-replaced='true']")
  );
}

function hasSoftUnsafeAncestor(element) {
  return Boolean(closestAcrossRoots(element, SOFT_UNSAFE_ANCESTOR_SELECTOR));
}

function isVisibleRect(rect) {
  return rect.width >= VISIBLE_MIN_WIDTH && rect.height >= VISIBLE_MIN_HEIGHT;
}

function isSmallContainer(rect) {
  return rect.width <= 420 || rect.height <= 320;
}

function isBoundedAdContainerRect(rect) {
  return (
    isVisibleRect(rect) &&
    rect.width <= 1100 &&
    rect.height <= 340 &&
    rect.width * rect.height <= 260000
  );
}

function isNarrowContentRail(element, rect) {
  if (rect.width > 360 || rect.height <= 760) {
    return false;
  }

  const text = String(element.innerText || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    text.length > 180 &&
    element.children.length > 3 &&
    !hasOwnAdIdentifier(element) &&
    !isBrandingTakeover(element)
  );
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

function canCollapseOversizedDomainCosmetic(element, rect) {
  const cosmeticMatch =
    typeof getCosmeticMatch === "function" ? getCosmeticMatch(element) : null;
  if (!cosmeticMatch || !cosmeticMatch.domains || cosmeticMatch.domains.length === 0) {
    return false;
  }

  if (!isTooLargeForMvp(rect)) {
    return false;
  }

  if (element.matches("html,body,main,article,header,footer,form")) {
    return false;
  }

  return (
    rect.width <= window.innerWidth * 1.05 &&
    rect.height <= Math.max(1200, window.innerHeight * 1.35)
  );
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

// A picture the site sized for itself is content. Display creatives arrive at
// the standard sizes or from an ad host, so a bare image whose only ad signal
// is a class token is a photograph — TechRadar writes its article heroes as
// class="block-image-ads hero-image". An ad-identified container around such an
// image is still a candidate on its own, so nothing real is lost here.
function isContentImage(element, rect) {
  return (
    element.matches("img,picture") &&
    !isCommonAdSize(rect) &&
    !hasAdLikeSource(element)
  );
}

// A citation, caption, or table cell naming an advertising publication carries
// an ad token in its identifier and nothing else that says "slot". It stays
// under the height floor at desktop widths, so nothing caught it until the page
// narrowed and the sentence wrapped onto a third line.
//
// Real slots live in these tags too — commerce tiles in a carousel are `li` with
// prose-length text — and the thing that separates them is structure, not media:
// a tile is a built layout of ten to fourteen elements, while a sentence holds a
// link at most. Media is the wrong test because tiles lazy-load their images,
// so at scan time they look as empty as prose does.
function isProseBlock(element) {
  if (
    !element.matches(PROSE_FLOW_SELECTOR) ||
    element.querySelectorAll("*").length > PROSE_MAX_ELEMENTS ||
    element.querySelector(AD_MEDIA_SELECTOR) ||
    hasAdLikeSource(element)
  ) {
    return false;
  }

  const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
  return text.length > AD_LABEL_MAX_LENGTH && !MARKUP_AS_TEXT_RE.test(text);
}

function isSidebarElement(element) {
  return Boolean(
    closestAcrossRoots(element, "aside,[role='complementary']") ||
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

function findLinkedMediaAdContainer(element) {
  if (!isLinkedCommonMediaAd(element)) {
    return null;
  }

  const link = closestAcrossRoots(element, "a[href]");
  if (!link) {
    return null;
  }

  let current = link.parentElement;
  let depth = 0;

  while (current && current !== document.body && depth < 3) {
    if (
      current instanceof HTMLElement &&
      !current.matches("main,article,nav,header,footer,form") &&
      containsOnlyLinkedMediaAd(current, link, element) &&
      hasSimilarRect(element, current) &&
      safeToReplace(current)
    ) {
      return current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return null;
}

function isLinkedCommonMediaAd(element) {
  if (!(element instanceof HTMLElement) || !element.matches("img,embed")) {
    return false;
  }

  if (!closestAcrossRoots(element, "a[href]") || !isSidebarElement(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return isVisibleRect(rect) && isCommonAdSize(rect) && !isLikelyHeroBanner(element);
}

function containsOnlyLinkedMediaAd(container, link, media) {
  if (container.querySelector("form,input,textarea,select,[contenteditable='true']")) {
    return false;
  }

  const children = Array.from(container.children).filter((child) => {
    return !child.matches("script,style,noscript");
  });
  if (children.length !== 1 || children[0] !== link) {
    return false;
  }

  if (!link.contains(media) || link.textContent.trim()) {
    return false;
  }

  const linkedMedia = Array.from(
    link.querySelectorAll("img,embed,iframe,picture")
  );
  return linkedMedia.length >= 1 && linkedMedia.length <= 2;
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
