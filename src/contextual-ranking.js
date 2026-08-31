const CONTEXTUAL_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "with",
  "и",
  "в",
  "во",
  "на",
  "с",
  "со",
  "к",
  "по",
  "из",
  "за",
  "для",
  "це",
  "та",
  "і",
  "й",
  "у",
  "з",
  "до"
]);

const CONTEXTUAL_FIELD_WEIGHTS = {
  title: 3,
  headings: 2,
  location: 1
};

function rankContextualNotes(pageContext, notes) {
  const normalizedNotes = Array.isArray(notes)
    ? notes.map((note) => String(note || "").trim()).filter(Boolean)
    : [];
  if (!normalizedNotes.length) {
    return [];
  }

  const queryWeights = buildContextTokenWeights(pageContext);
  const noteTokens = normalizedNotes.map(tokenizeContextualText);
  const documentFrequency = new Map();
  noteTokens.forEach((tokens) => {
    new Set(tokens).forEach((token) => {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    });
  });

  const averageLength =
    noteTokens.reduce((sum, tokens) => sum + tokens.length, 0) /
    noteTokens.length;
  const results = normalizedNotes.map((note, index) => {
    const contributionByToken = scoreContextualDocument({
      tokens: noteTokens[index],
      queryWeights,
      documentFrequency,
      documentCount: noteTokens.length,
      averageLength
    });
    const score = Array.from(contributionByToken.values()).reduce(
      (sum, contribution) => sum + contribution,
      0
    );
    const matchedTerms = Array.from(contributionByToken.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([token]) => token);
    const reasons = matchedTerms.map(
      (token) => `Matched “${token}” in the page context.`
    );
    const confidence = getContextualMatchConfidence(matchedTerms, score);

    return { note, score, confidence, reasons, index };
  });

  return results
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ index, ...result }) => result);
}

function getContextualMatchConfidence(matchedTerms, score) {
  if (score <= 0 || !matchedTerms.length) {
    return "none";
  }
  if (
    matchedTerms.length >= 2 ||
    matchedTerms.some((term) => term.length >= 6)
  ) {
    return "strong";
  }
  return "weak";
}

function buildContextTokenWeights(pageContext = {}) {
  const weights = new Map();
  addWeightedContextTokens(weights, pageContext.title, CONTEXTUAL_FIELD_WEIGHTS.title);
  addWeightedContextTokens(
    weights,
    Array.isArray(pageContext.headings) ? pageContext.headings.join(" ") : "",
    CONTEXTUAL_FIELD_WEIGHTS.headings
  );

  let locationText = "";
  try {
    const parsed = new URL(String(pageContext.url || ""));
    locationText = `${parsed.hostname} ${parsed.pathname.replace(/[\/_-]+/g, " ")}`;
  } catch (_error) {
    locationText = "";
  }
  addWeightedContextTokens(
    weights,
    locationText,
    CONTEXTUAL_FIELD_WEIGHTS.location
  );
  return weights;
}

function addWeightedContextTokens(weights, value, fieldWeight) {
  tokenizeContextualText(value).forEach((token) => {
    weights.set(token, (weights.get(token) || 0) + fieldWeight);
  });
}

function tokenizeContextualText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 1 && !CONTEXTUAL_STOP_WORDS.has(token)) || [];
}

function scoreContextualDocument({
  tokens,
  queryWeights,
  documentFrequency,
  documentCount,
  averageLength
}) {
  const termFrequency = new Map();
  tokens.forEach((token) => {
    termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
  });

  const contributions = new Map();
  const k1 = 1.2;
  const lengthNormalization = 0.75;
  const safeAverageLength = averageLength || 1;
  queryWeights.forEach((queryWeight, token) => {
    const frequency = termFrequency.get(token) || 0;
    if (!frequency) {
      return;
    }

    const frequencyInDocuments = documentFrequency.get(token) || 0;
    const inverseDocumentFrequency = Math.log(
      1 +
        (documentCount - frequencyInDocuments + 0.5) /
          (frequencyInDocuments + 0.5)
    );
    const denominator =
      frequency +
      k1 *
        (1 -
          lengthNormalization +
          lengthNormalization * (tokens.length / safeAverageLength));
    contributions.set(
      token,
      inverseDocumentFrequency * ((frequency * (k1 + 1)) / denominator) * queryWeight
    );
  });
  return contributions;
}

globalThis.NotesNotAdsContextualRanking = Object.freeze({
  rankContextualNotes
});
