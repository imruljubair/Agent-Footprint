const PRIVATE_HOST = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[?::1\]?|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2})$/i;
const SENSITIVE_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|gad_source|gad_campaignid|gbraid|wbraid|token|access_token|api[_-]?key|key|auth|authorization|password|passwd|secret|signature|sig|session|sessionid|jwt|credential|code|state|x-amz-.+)$/i;

export function sanitizeResearchUrl(value) {
  try {
    const clean = String(value || "").replace(/\.?-{5,}.*$/, "").replace(/[),.;:!?]+$/, "");
    const url = new URL(clean);
    if (!/^https?:$/.test(url.protocol) || PRIVATE_HOST.test(url.hostname)) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) if (SENSITIVE_PARAMETER.test(name)) url.searchParams.delete(name);
    return url.toString();
  } catch { return null; }
}

function stringsFrom(value, output = []) {
  if (output.join("").length > 250000) return output;
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsFrom(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringsFrom(item, output);
  return output;
}

export function extractResearchLinks(value, limit = 6) {
  const links = [];
  const seen = new Set();
  const text = stringsFrom(value).join("\n");
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
    const url = sanitizeResearchUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const parsed = new URL(url);
    links.push({ label: parsed.hostname.replace(/^www\./, ""), url });
    if (links.length >= limit) break;
  }
  return links;
}
