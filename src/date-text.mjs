// Text that names a calendar date, in the forms report and ERP date pickers
// take: 2026/1/1, 2026-01-01 08:30, 10/20/2026, 20.10.26, 2026年1月1日,
// 2026-10 (month pickers), Oct 20, 2026 and 20 October 2026.
const NUMERIC = /^\s*(?:\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?|\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2}))(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\s*$/;
const CJK = /^\s*\d{4}\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?\s*$/;
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const NAMED = new RegExp(`^\\s*(?:\\d{1,2}\\s+${MONTH},?\\s+\\d{4}|${MONTH}\\s+\\d{1,2},?\\s+\\d{4})\\s*$`, "i");

export function isDateText(value) {
  const text = String(value ?? "");
  return text.length <= 40 && (NUMERIC.test(text) || CJK.test(text) || NAMED.test(text));
}

// The same date with other zero padding or separators, as a picker rewrites
// it when it commits: 2026/1/1 and 2026-01-01. The parts must come in the same
// order, so 1/2/2026 and 2026/1/2 never compare equal.
export function sameDateText(a, b) {
  if (!isDateText(a) || !isDateText(b)) return false;
  const parts = (text) => String(text).toLowerCase().match(/\d+|[a-z]+/g)
    .map((part) => (/^\d+$/.test(part) ? String(Number(part)) : part.slice(0, 3)));
  const x = parts(a);
  const y = parts(b);
  return x.length === y.length && x.every((part, i) => part === y[i]);
}
