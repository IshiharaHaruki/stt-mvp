/**
 * Deterministic text cleanup — ported from Handy's filter_transcription_output.
 * Pure regex, no model, runs locally and instantly.
 */

const FILLER_WORDS: Record<string, string[]> = {
  en: ["uh", "um", "uhm", "umm", "uhh", "uhhh", "ah", "hmm", "hm", "mmm", "mm", "mh", "eh", "ehh"],
  zh: ["呃", "嗯", "那个", "这个"],
};

function fillerFor(lang: string): string[] {
  const base = lang.split(/[-_]/)[0];
  return FILLER_WORDS[base] ?? FILLER_WORDS.en;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove filler words, collapse stutters, normalize whitespace. */
export function cleanupTranscript(
  text: string,
  lang = "en",
  customFillers?: string[],
): string {
  let out = text;
  const fillers = customFillers && customFillers.length ? customFillers : fillerFor(lang);

  for (const w of fillers) {
    const re = new RegExp(`\\b${escapeRegExp(w)}\\b[,.]?`, "gi");
    out = out.replace(re, "");
  }

  // Collapse repeated 1-2 letter "stutter" tokens: "wh wh wh" -> "wh"
  out = out.replace(/\b(\w{1,2})(\s+\1\b)+/gi, "$1");

  // Multiple spaces -> single; trim
  out = out.replace(/\s{2,}/g, " ").trim();

  return out;
}
