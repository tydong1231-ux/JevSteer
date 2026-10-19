// Shared detection of secret-like names (form value keys, field labels,
// JSON keys and query parameters).
//
// Long tokens match anywhere. Short tokens such as "pin", "otp" or "pass"
// match only as whole words, so ordinary names like "shipping_address",
// "mapping" or "passed" are not mistaken for secrets.
const LONG = /(pass(word|wd|code|phrase)|secret|token|api[-_ ]?key|authorization|cookie|security[-_ ]?code)/i;
const SHORT = /(^|[^a-z0-9])(pass|pin(code)?|otp(code)?|2fa|cvv2?|cvc2?)([^a-z0-9]|$)/i;

export function isSensitiveName(value) {
  const name = String(value ?? "");
  if (LONG.test(name)) return true;
  // Split camelCase ("cardPin", "smsOtp") so word boundaries apply.
  return SHORT.test(name.replace(/([a-z])([A-Z])/g, "$1 $2"));
}
