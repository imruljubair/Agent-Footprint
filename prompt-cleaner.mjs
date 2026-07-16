export function cleanPrompt(value) {
  return String(value || "").replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function titleFromPrompt(prompt) {
  const clean = cleanPrompt(prompt);
  const sentence = clean.split(/(?<=[.!?])\s/)[0] || "Codex task";
  return sentence.length > 74 ? `${sentence.slice(0, 71).trim()}…` : sentence;
}

export function meaningfulOutcome(value) {
  const outcome = String(value || "").replace(/\s+/g, " ").trim();
  if (!outcome) return "";
  const generic = [
    /task was reviewed.*no (?:file|command|activity)/i,
    /no (?:file|command) activity was recorded/i,
    /this part of the work was completed/i,
    /remaining recorded work was completed/i,
    /^\d+ related actions? (?:was|were) recorded[.!]?$/i,
    /^the (?:available )?actions? (?:was|were) recorded[.!]?$/i,
  ];
  return generic.some((pattern) => pattern.test(outcome)) ? "" : outcome;
}
