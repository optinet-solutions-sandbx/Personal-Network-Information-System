// Shared long-input guarding for AI call sites.
//
// We send freeform text (typed stories, dictated brain-dumps, accumulated notes)
// to the OpenAI chat API. Very long input risks token-limit errors and runaway
// cost, so we cap each prompt to a token budget *before* the call.
//
// Strategy: TRUNCATE to a budget (no chunk-and-merge). We avoid a tiktoken
// dependency and approximate tokens with a chars≈tokens*4 heuristic, which is
// conservative for English prose. Budgets below leave generous headroom under
// gpt-4o-mini's context window while keeping cost bounded.

// Rough average: ~4 characters per token for English text. Deliberately a slight
// under-estimate of tokens (i.e. we treat text as cheaper than it is) would risk
// overshooting, so this errs toward counting tokens generously.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

export type TruncateResult = {
  text: string;
  truncated: boolean;
  // Tokens (estimated) dropped from the tail.
  droppedTokens: number;
};

// Truncate a single block of text to a token budget, keeping the HEAD. Used for
// the story-extraction path, where the opening of a story carries the identity
// of the person being described. Cuts on a word boundary when possible.
export function truncateToBudget(
  text: string,
  maxTokens: number
): TruncateResult {
  const maxChars = tokensToChars(maxTokens);
  if (text.length <= maxChars) {
    return { text, truncated: false, droppedTokens: 0 };
  }
  let head = text.slice(0, maxChars);
  // Prefer cutting at the last whitespace so we don't slice a word in half.
  const lastSpace = head.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.8) head = head.slice(0, lastSpace);
  return {
    text: head.trimEnd(),
    truncated: true,
    droppedTokens: estimateTokens(text.slice(head.length)),
  };
}

export type BudgetedNote = { content: string; createdAt: Date | string };

export type NotesBudgetResult<T extends BudgetedNote> = {
  // The notes that fit, returned in ORIGINAL (caller-provided) order.
  notes: T[];
  truncated: boolean;
  // How many notes were dropped entirely to fit the budget.
  droppedCount: number;
};

// Fit a list of notes within a token budget by keeping the MOST RECENT notes
// (by createdAt) and dropping the oldest. Recent notes are the most relevant to
// a current relationship profile. The kept notes are returned in their original
// order so the caller's numbering/formatting is unaffected.
export function fitNotesToBudget<T extends BudgetedNote>(
  notes: T[],
  maxTokens: number
): NotesBudgetResult<T> {
  if (notes.length === 0) {
    return { notes, truncated: false, droppedCount: 0 };
  }

  const maxChars = tokensToChars(maxTokens);
  // Walk newest-first, accumulating until we'd blow the budget.
  const byNewest = notes
    .map((n, i) => ({ n, i, t: new Date(n.createdAt).getTime() }))
    .sort((a, b) => b.t - a.t);

  const keptIdx = new Set<number>();
  let used = 0;
  for (const { n, i } of byNewest) {
    const cost = n.content.length;
    // Always keep at least the single newest note, even if it alone exceeds the
    // budget — its content gets head-truncated by the per-note guard below.
    if (keptIdx.size > 0 && used + cost > maxChars) break;
    keptIdx.add(i);
    used += cost;
  }

  const kept = notes.filter((_, i) => keptIdx.has(i));
  return {
    notes: kept,
    truncated: kept.length < notes.length,
    droppedCount: notes.length - kept.length,
  };
}
