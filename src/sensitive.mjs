// Shared detection of secret-like names (form value keys, field labels,
// JSON keys and query parameters).
//
// Long tokens match anywhere. Short tokens ("pass", "pin", "otp", ...) match
// when they end a word, optionally with a suffix such as "code" or "number":
// "userpass", "cardPin", "pin1", "totp" and "pin_code" are secrets, while
// "shipping_address", "mapping", "opinion" and "passed" are not.
// When in doubt this errs toward hiding: a hidden value can still be typed.
const LONG = /(pass(word|wd|code|phrase|key|port)|secret|token|api[-_ ]?key|authorization|cookie|security[-_ ]?code)/i;
const SHORT = /(pass|pin|otp|2fa|cvv|cvc)(code|number|num|no|value|hash)?s?(?![a-z])/i;

export function isSensitiveName(value) {
  const name = String(value ?? "");
  if (LONG.test(name)) return true;
  // Split camelCase ("cardPinNumber" -> "card Pin Number") so word ends apply.
  return SHORT.test(name.replace(/([a-z])([A-Z])/g, "$1 $2"));
}
