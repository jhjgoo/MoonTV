const DEFAULT_MAX_URL_LENGTH = 2048;

function isIpLiteral(hostname: string): boolean {
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    (hostname.startsWith('[') && hostname.endsWith(']'))
  );
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/\.$/, '').toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'local' ||
    normalized.endsWith('.local')
  );
}

/**
 * Applies the deterministic URL checks available in the Cloudflare Edge
 * runtime. DNS rebinding and hostnames that resolve to private IPs are outside
 * this policy because Edge does not expose a reliable DNS lookup API.
 */
export function validatePublicHttpsUrl(
  raw: string,
  maxLength = DEFAULT_MAX_URL_LENGTH
): URL {
  const value = raw.trim();
  if (!value) {
    throw new Error('URL 不能为空');
  }
  if (value.length > maxLength) {
    throw new Error(`URL 长度不能超过 ${maxLength}`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL 格式不正确');
  }

  if (url.protocol !== 'https:') {
    throw new Error('只允许使用 HTTPS URL');
  }
  if (url.username || url.password) {
    throw new Error('URL 不允许包含凭据');
  }
  if (isLocalHostname(url.hostname) || isIpLiteral(url.hostname)) {
    throw new Error('URL 必须指向公网域名');
  }

  return url;
}
