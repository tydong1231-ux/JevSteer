// Shared detection of secret-like names: form value keys, field labels, JSON
// keys and query parameters. Readers that run inside the page and cannot
// import this module receive SENSITIVE_PATTERNS instead (see browser/inspect).
//
// Long tokens match anywhere. Short tokens ("pass", "pin", "otp", ...) match
// when they end a word, optionally with a suffix such as "code" or "number":
// "userpass", "cardPin", "pin1", "totp" and "pin_code" are secrets, while
// "shipping_address", "mapping", "opinion" and "passed" are not.
// When in doubt this errs toward hiding: a hidden value can still be typed.
// "secret" excludes "secretary": a company secretary is an ordinary business field.
const LONG = "pass(word|wd|code|phrase|key|port)|secret(?!ar)|token|authorization|cookie|(api|security|verification|access|private)[-_.\\s]*(key|code)";
const SHORT = "(pass|pin|otp|2fa|cvv|cvc)(code|number|num|no|value|hash)?s?(?![a-z])";

export const SENSITIVE_PATTERNS = Object.freeze({ long: LONG, short: SHORT });

const long = new RegExp(LONG, "i");
const short = new RegExp(SHORT, "i");

export function sensitiveName(value) {
  const name = String(value ?? "");
  // Split camelCase ("cardPinNumber" -> "card Pin Number") so word ends apply.
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2");
  return long.test(name) || long.test(words) || short.test(words);
}

// A field is secret by its type, by what names it (its label, name or
// placeholder, the text drawn over it when it has no name, its table column),
// or because the snapshot marked it so: a field seen as secret stays secret
// once the text that named it goes, as text drawn over a field does when it
// holds a value (Codex on ebc7159).
export function sensitiveField(element) {
  return element?.secret === true || element?.type === "password"
    || sensitiveName([element?.label, element?.name, element?.placeholder, element?.hint, element?.column].filter(Boolean).join(" "));
}
