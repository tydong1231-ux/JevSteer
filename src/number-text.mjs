// A number field formats what was typed once it takes it: ccMonet's Unit
// Price showed 5000 as "5,000", and the run stopped on a failed effect (Mac
// run on 9a83708). A text field may only add to the number typed: grouping
// marks between digit groups of three, and zeros after the decimal point
// (5000 as 5,000, 5 000 or 5,000.00; 1.5 as 1.50). It never takes away what
// was typed: 123 for 00123, 1 for 1.0, or 10% for 10 are other values, such
// as a reference or a version the site cut short or changed (Codex on
// b2d32ae and 7519fff). A field known to hold a number (type=number, role
// spinbutton) compares the numbers both texts read as, so it also drops
// leading zeros, a plus sign, zeros after the point and a trailing percent
// sign. A currency, a unit, a second number or a grouping mark that does not
// part groups of three makes no match.
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

// Whether a text field that shows `shown` added only formatting to the
// number typed: grouping marks where the typed text has none, zeros after its
// decimals (with a point for them), or a zero before a bare point. A point
// with nothing after it may come or go.
function addsFormatting(shown, typed) {
  const s = String(shown ?? "").trim();
  const t = String(typed ?? "").trim();
  if (t.length > 40 || s.length > 80) return false;
  const was = PLAIN.exec(t);
  const now = PLAIN.exec(s.replace(GROUPING, "$1"));
  if (!was || !now || !was[2] && !was[3]) return false;
  const [, sign, whole, decimals = ""] = was;
  const [, shownSign, shownWhole, shownDecimals = ""] = now;
  return shownSign === sign && (shownWhole === whole || !whole && shownWhole === "0")
    && shownDecimals.startsWith(decimals) && /^0*$/.test(shownDecimals.slice(decimals.length));
}

// A field the page says holds a number.
export function numericField(e) {
  return e?.type === "number" || e?.role === "spinbutton";
}

// Whether a field that shows `shown` holds the number `typed` was.
export function sameNumberText(shown, typed, { numeric = false } = {}) {
  if (!numeric) return addsFormatting(shown, typed);
  const x = plainNumber(shown);
  return x !== undefined && x === plainNumber(typed);
}
