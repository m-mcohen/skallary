import { posix } from "node:path";

const word = /[\p{L}\p{N}_]/u;
// For curated names and ids, an underscore, hyphen or dot beside the name is a boundary.
const nameWord = /[\p{L}\p{N}]/u;
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function bounded(text, index, length, inner = word) {
  return !inner.test(text[index - 1] ?? "") && !inner.test(text[index + length] ?? "");
}

function eligible(cents) {
  // The builder must restrict whole-dollar inputs to budgets, settings and balances.
  return Number.isSafeInteger(cents) &&
    ((cents >= 10000 && cents % 100 !== 0) || (cents >= 100000 && cents % 10000 !== 0));
}

function numericContext(text, index, length) {
  const before = text.slice(0, index);
  const after = text.slice(index + length);
  if (!bounded(text, index, length)) return false;
  // A comma before or after starts or ends another value; only a dot joins digits.
  if (/\d\.$/.test(before) || /^\.\d/.test(after)) return false;
  // Line numbers, "#" references and file:line positions are bare integers, never money.
  if (/^\d+$/.test(text.slice(index, index + length)) &&
      (/(?:#|\bline\b[ \t]*[:#]?[ \t]*|\b[^\s:]+\.[a-z\d]+:)[ \t]*$/i.test(before) || /^:/.test(after))) return false;
  // Dates and multi-part versions are excluded as a whole, rather than as fragments.
  const exclusions = /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|v?\d+(?:\.\d+){2,})\b/gi;
  for (const match of text.matchAll(exclusions)) {
    if (index < match.index + match[0].length && index + length > match.index) return false;
  }
  return true;
}

function tailContext(text, index, length, names) {
  const before = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
  const cues = /\b(?:account|acct|checking|savings|card|ending(?:[ \t]+in)?)\b/gi;
  for (const cue of before.matchAll(cues)) {
    if (before.length - cue.index <= 24) return true;
  }
  if (/(?:x{2,}|\*{2,}|\.{3})/i.test(before.slice(-24))) return true;
  if (!/^[ \t]*\)/.test(text.slice(index + length))) return false;
  return names.some((name) => new RegExp(escape(name) + "[ \\t]*\\([ \\t]*$", "iu").test(before) &&
    bounded(before, before.toLowerCase().lastIndexOf(name.toLowerCase()), name.length, nameWord));
}

/**
 * Return positions and kinds only. Allow tokens refer to their exact written form,
 * case-insensitively, and require a matching path glob. Pathless callers use @text.
 * Limits: sub-threshold amounts, uncurated names, images and encoded text.
 * @param {string} text
 * @param {{amountsCents: Set<number>, strings: string[], tails?: string[], ids?: string[], allow: Set<string>}} inputs
 * @param {string} [path]
 * @returns {{index: number, kind: "amount" | "string"}[]}
 */
export function findMatches(text, inputs, path = "@text") {
  const allowed = new Set();
  for (const entry of inputs.allow ?? []) {
    const separator = entry.indexOf(" :: ");
    if (separator < 1) continue;
    const glob = entry.slice(0, separator).replaceAll("\\", "/");
    // A file glob cannot accidentally allow a pathless message.
    if (path.startsWith("@") ? glob === path : !glob.startsWith("@") && posix.matchesGlob(path.replaceAll("\\", "/"), glob)) {
      allowed.add(entry.slice(separator + 4).trim().toLowerCase());
    }
  }
  const matches = [];
  const add = (index, token, kind) => {
    if (!allowed.has(token.toLowerCase()) && !matches.some((match) => match.index === index && match.kind === kind)) {
      matches.push({ index, kind });
    }
  };
  const amounts = new Set([...inputs.amountsCents].map(Math.abs).filter(eligible));
  const checkNumber = (index, token) => {
    if (!numericContext(text, index, token.length)) return;
    const normalized = token.replace(/[$_, \t]/g, "");
    const decimal = normalized.includes(".");
    if (decimal && normalized.split(".")[1].length > 2) return;
    const number = Number(normalized);
    const dollars = decimal || token.startsWith("$") || /[_,]/.test(token);
    if ((!decimal && !token.startsWith("$") && amounts.has(number)) ||
        (dollars && amounts.has(Math.round(number * 100)))) add(index, token, "amount");
  };
  // A comma groups thousands only after 1 to 3 digits and before groups of exactly 3;
  // otherwise it separates two numbers, each checked on its own.
  for (const match of text.matchAll(/\$?[ \t]*(?:\d{1,3}(?:,\d{3})+(?![\d_]|,\d)|\d+(?:_\d+)*)(?:\.\d+)?/g)) {
    // Whitespace belongs to a currency prefix only, not to ordinary numbers.
    const token = match[0].trimStart();
    const index = match.index + match[0].length - token.length;
    checkNumber(index, token);
    // "17,987.65" reads as one number or as two (a CSV row); either reading can match.
    let offset = 0;
    if (token.includes(",")) for (const piece of token.split(",")) {
      checkNumber(index + offset, piece);
      offset += piece.length + 1;
    }
  }
  const names = inputs.strings.filter((value) => value.length >= 6);
  // "=NAME" entries match at any length (3+ after the "="), as a whole word only.
  const exact = inputs.strings.filter((value) => value.startsWith("=") && value.length >= 4).map((value) => value.slice(1));
  for (const token of new Set([...names, ...exact, ...(inputs.ids ?? []).filter((value) => value.length >= 6)])) {
    for (const match of text.matchAll(new RegExp(escape(token), "giu"))) {
      if (bounded(text, match.index, match[0].length, nameWord)) add(match.index, match[0], "string");
    }
  }
  for (const tail of inputs.tails ?? []) {
    if (!/^\d{4}$/.test(tail)) continue;
    for (const match of text.matchAll(new RegExp(tail, "g"))) {
      if (!/\d/.test(text[match.index - 1] ?? "") && !/\d/.test(text[match.index + 4] ?? "") &&
          tailContext(text, match.index, 4, names)) add(match.index, tail, "string");
    }
  }
  return matches.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
}
