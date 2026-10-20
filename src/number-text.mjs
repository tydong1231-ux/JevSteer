// A number field formats what was typed once it takes it: ccMonet's Unit
// Price showed 5000 as "5,000", and the run stopped on a failed effect (Mac
// run on 9a83708). Two texts are the same number when, with the grouping
// marks between digit groups taken out, they read as equal plain decimals:
// 5000, 5,000, 5 000 and 5,000.00. A trailing percent sign is part of the
// format too (10 and 10%). A currency, a unit, a second number or a grouping
// mark that does not part groups of three makes no match.
const GROUPING = /(\d)[,\s  '’_](?=\d{3}(?!\d))/g;
const PLAIN = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function plainNumber(value) {
  const text = String(value ?? "").trim().replace(/\s*%$/, "");
  if (text.length > 40) return undefined;
  const plain = text.replace(GROUPING, "$1");
  return PLAIN.test(plain) ? Number(plain) : undefined;
}

export function sameNumberText(a, b) {
  const x = plainNumber(a);
  const y = plainNumber(b);
  return x !== undefined && y !== undefined && Number.isFinite(x) && x === y;
}
