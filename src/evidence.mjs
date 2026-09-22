const SENSITIVE_KEY = /(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|otp|2fa|pin|cvv|cvc|security[-_]?code)/i;

function truncate(value, max = 1200) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (!s) return s;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}


function safeUrl(value) {
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, "[REDACTED]");
    return url.toString();
  } catch {
    return String(value || "").slice(0, 1000);
  }
}

function redact(value, depth = 0) {
  if (depth > 5) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(child, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.replace(/(bearer\s+)[a-z0-9._~+/=-]+/ig, "$1[REDACTED]");
  return value;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return redact(value);
  try { return redact(JSON.parse(value)); } catch { return redact(value); }
}

export function relevantRequest(request) {
  const method = String(request?.method || "GET").toUpperCase();
  const status = Number(request?.status || 0);
  return !["GET", "HEAD", "OPTIONS"].includes(method) || status >= 400;
}

export function evidenceRef(runId, milestoneId, requestId) {
  return `${runId}:${milestoneId}:${requestId}`;
}

export function sanitizeNetworkBody(body) {
  if (!body) return {};
  return {
    ...(body.requestBody != null ? { request_body: parseMaybeJson(body.requestBody) } : {}),
    ...(body.body != null ? { response_body: parseMaybeJson(body.body) } : {}),
    ...(body.bodyError ? { body_error: String(body.bodyError).slice(0, 300) } : {}),
    ...(body.bodyTruncated ? { body_truncated: true } : {}),
    ...(body.size != null ? { size: body.size } : {}),
  };
}

export function summarizeRequest(request, body, ref) {
  const sanitized = body ? sanitizeNetworkBody(body) : undefined;
  return {
    request_id: request.requestId,
    method: request.method,
    url: safeUrl(request.url),
    status: request.status,
    type: request.type,
    ...(request.hasPostData ? { has_post_data: true } : {}),
    ...(ref ? { evidence_ref: ref } : {}),
    ...(sanitized?.request_body != null ? { request_preview: truncate(sanitized.request_body, 900) } : {}),
    ...(sanitized?.response_body != null ? { response_preview: truncate(sanitized.response_body, 900) } : {}),
    ...(sanitized?.body_error ? { body_error: sanitized.body_error } : {}),
  };
}

export function buildEvidencePacket({ runId, milestone, result, network }) {
  return {
    run_id: runId,
    milestone_id: milestone.id,
    goal: milestone.goal,
    result: result.status,
    actions: (result.actions || []).map((x) => ({
      ...(x.action ? { action: x.action } : {}),
      ...(x.element ? { element: x.element } : {}),
      ...(x.value ? { value_key: x.value } : {}),
      ...(x.key ? { key: x.key } : {}),
      ...(x.effect ? { effect: x.effect } : {}),
      ...(x.error ? { error: x.error } : {}),
      ...(x.recovery ? { recovery: x.recovery } : {}),
    })),
    verification: result.verification,
    final_page: { url: result.url, title: result.title },
    network,
  };
}

export { redact };
