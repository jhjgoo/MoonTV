import { validatePublicHttpsUrl } from './source-url';

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchTextOptions {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export async function fetchTextWithLimits(
  rawUrl: string,
  options: FetchTextOptions = {}
): Promise<string> {
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let currentUrl = validatePublicHttpsUrl(rawUrl);
    for (let requestIndex = 0; requestIndex <= maxRedirects; requestIndex++) {
      const response = await fetchImpl(currentUrl.href, {
        redirect: 'manual',
        signal: controller.signal,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        if (requestIndex === maxRedirects) {
          throw new Error(`订阅重定向次数不能超过 ${maxRedirects}`);
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('订阅重定向缺少 Location');
        }
        currentUrl = validatePublicHttpsUrl(new URL(location, currentUrl).href);
        continue;
      }

      if (!response.ok) {
        throw new Error(`订阅请求失败（HTTP ${response.status}）`);
      }
      if (!response.body) {
        return '';
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let readResult = await reader.read();
      while (!readResult.done) {
        const { value } = readResult;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error(`订阅响应过大（上限 ${maxBytes} 字节）`);
        }
        chunks.push(value);
        readResult = await reader.read();
      }

      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error('订阅响应不是有效的 UTF-8 文本');
      }
    }
    throw new Error('订阅请求未返回有效响应');
  } catch (error) {
    if (timedOut || (error as Error).name === 'AbortError') {
      throw new Error('订阅请求超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
