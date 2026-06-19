import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  truncateToBudget,
  fitNotesToBudget,
} from "@/lib/textBudget";

describe("estimateTokens", () => {
  it("approximates ~4 chars per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // 5/4 -> ceil
  });
});

describe("truncateToBudget", () => {
  it("leaves short text untouched", () => {
    const res = truncateToBudget("hello world", 100);
    expect(res.truncated).toBe(false);
    expect(res.text).toBe("hello world");
    expect(res.droppedTokens).toBe(0);
  });

  it("truncates over-budget text and flags it", () => {
    // budget of 1 token -> ~4 chars
    const res = truncateToBudget("abcdefghij", 1);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThanOrEqual(4);
    expect(res.droppedTokens).toBeGreaterThan(0);
  });

  it("prefers cutting on a word boundary near the budget", () => {
    // 10-token budget ~ 40 chars; the space before the final word sits well
    // past 80% of the budget, so we cut there rather than mid-word.
    const text = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk";
    const res = truncateToBudget(text, 10);
    expect(res.truncated).toBe(true);
    expect(res.text.endsWith(" ")).toBe(false);
    expect(res.text).not.toContain("jjjj"); // tail dropped
    // No partial word at the end: last token is a full 4-char word.
    expect(res.text.split(" ").at(-1)).toMatch(/^[a-z]{4}$/);
  });
});

describe("fitNotesToBudget", () => {
  const note = (content: string, daysAgo: number) => ({
    content,
    createdAt: new Date(2026, 0, 31 - daysAgo),
  });

  it("returns empty input unchanged", () => {
    const res = fitNotesToBudget([], 1000);
    expect(res.truncated).toBe(false);
    expect(res.droppedCount).toBe(0);
    expect(res.notes).toEqual([]);
  });

  it("keeps everything when within budget", () => {
    const notes = [note("aaaa", 2), note("bbbb", 1)];
    const res = fitNotesToBudget(notes, 1000);
    expect(res.truncated).toBe(false);
    expect(res.droppedCount).toBe(0);
    expect(res.notes).toHaveLength(2);
  });

  it("drops the OLDEST notes first when over budget", () => {
    const oldest = note("oldoldold", 10);
    const middle = note("midmidmid", 5);
    const newest = note("newnewnew", 1);
    // Budget fits ~2 of the 9-char notes (~18 chars).
    const res = fitNotesToBudget([oldest, middle, newest], 5);
    expect(res.truncated).toBe(true);
    expect(res.droppedCount).toBe(1);
    expect(res.notes).toContain(newest);
    expect(res.notes).toContain(middle);
    expect(res.notes).not.toContain(oldest);
  });

  it("preserves original order in the kept notes", () => {
    const first = note("first", 3);
    const second = note("second", 2);
    const third = note("third", 1);
    const res = fitNotesToBudget([first, second, third], 1000);
    expect(res.notes).toEqual([first, second, third]);
  });

  it("always keeps at least the newest note, even if it alone exceeds budget", () => {
    const huge = note("x".repeat(1000), 1);
    const old = note("y".repeat(1000), 5);
    const res = fitNotesToBudget([old, huge], 1); // ~4 char budget
    expect(res.notes).toEqual([huge]);
    expect(res.droppedCount).toBe(1);
    expect(res.truncated).toBe(true);
  });
});
