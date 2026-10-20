// A number field formats what was typed once it takes it: ccMonet's Unit
// Price showed 5000 as "5,000", and the run stopped on a failed effect (Mac
// run on 9a83708). Two texts are the same number when, with the grouping
// marks between digit groups taken out, they read as equal plain decimals:
// 5000, 5,000, 5 000 and 5,000.00. A trailing percent sign is part of the
// format too (10 and 10%). A currency, a unit, a second number or a grouping
// mark that does not part groups of three makes no match.
const GROUPING = /(\d)[,\s  '’_](?=\d{3}(?!\d))/g;
const PLAIN = /^([-+]?)(\d*)(?:\.(\d*))?$/;

// The plain decimal a text reads as, written one way: no plus sign, no
// leading or trailing zeros, no point without decimals, and no sign on
// zero. It is compared as text, digit by digit: a JavaScript number keeps
// about 16 digits, so 9007199254740992 and 9,007,199,254,740,993 would read
// as one (Codex on 3fa0a57).
function plainNumber(value) {
  const text = String(value ?? "").trim().replace(/\s*%$/, "");
  if (text.length > 40) return undefined;
  const match = PLAIN.exec(text.replace(GROUPING, "$1"));
  if (!match || !match[2] && !match[3]) return undefined;
  const whole = match[2].replace(/^0+/, "") || "0";
  const decimals = (match[3] || "").replace(/0+$/, "");
  const sign = match[1] === "-" && (whole !== "0" || decimals) ? "-" : "";
  return `${sign}${whole}${decimals ? `.${decimals}` : ""}`;
}

export function sameNumberText(a, b) {
  const x = plainNumber(a);
  return x !== undefined && x === plainNumber(b);
}
