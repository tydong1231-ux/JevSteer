// A number field formats what was typed once it takes it: ccMonet's Unit
// Price showed 5000 as "5,000", and the run stopped on a failed effect (Mac
// run on 9a83708). In any field, two texts are the same number when they
// differ only in grouping marks between digit groups of three and in zeros
// after the decimal point: 5000, 5,000, 5 000 and 5,000.00. Nothing else
// counts there: in a text field, 00123 and 123, or 10 and 10%, are other
// values, such as a reference a site cut short (Codex on b2d32ae). A field
// known to hold a number (type=number, role spinbutton) also drops leading
// zeros, a plus sign and a trailing percent sign. A currency, a unit, a
// second number or a grouping mark that does not part groups of three makes
// no match.
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

// The decimal a text reads as, with only what any number field adds taken
// out: grouping marks, zeros after the point, and a point with nothing
// after it. A bare point gets its zero (.5 is 0.5).
function decimalText(value) {
  const text = String(value ?? "").trim();
  if (text.length > 40) return undefined;
  const match = PLAIN.exec(text.replace(GROUPING, "$1"));
  if (!match || !match[2] && !match[3]) return undefined;
  const decimals = (match[3] || "").replace(/0+$/, "");
  return `${match[1]}${match[2] || "0"}${decimals ? `.${decimals}` : ""}`;
}

// A field the page says holds a number.
export function numericField(e) {
  return e?.type === "number" || e?.role === "spinbutton";
}

export function sameNumberText(a, b, { numeric = false } = {}) {
  const read = numeric ? plainNumber : decimalText;
  const x = read(a);
  return x !== undefined && x === read(b);
}
