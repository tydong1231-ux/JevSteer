export function sensitiveName(value) {
  const words = String(value || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return /\b(password|passwd|secret|token|otp|2fa|pin|cvv|cvc)\b|\b(api|security|verification|access|private)\s*(key|code)\b/i.test(words);
}

export function sensitiveField(element) {
  return element?.type === "password" || sensitiveName([element?.label, element?.name, element?.placeholder].filter(Boolean).join(" "));
}
