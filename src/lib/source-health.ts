import { API_CONFIG } from './config';
import type { ApiSite } from './source.types';

const HEALTH_CHECK_TIMEOUT_MS = 8_000;
const HEALTH_CHECK_QUERY = '测试';

export interface SourceHealthResult {
  healthy: boolean;
  latencyMs: number;
  message: string;
}

export async function checkSourceHealth(
  source: ApiSite,
  fetchImpl: typeof fetch = fetch
): Promise<SourceHealthResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, HEALTH_CHECK_TIMEOUT_MS);
  const result = (healthy: boolean, message: string): SourceHealthResult => ({
    healthy,
    latencyMs: Math.max(0, Date.now() - startedAt),
    message,
  });

  try {
    const response = await fetchImpl(
      `${source.api}${API_CONFIG.search.path}${encodeURIComponent(
        HEALTH_CHECK_QUERY
      )}`,
      {
        headers: API_CONFIG.search.headers,
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      return result(false, `上游返回 HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return result(false, '响应不是合法 JSON');
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !Array.isArray((payload as { list?: unknown }).list)
    ) {
      return result(false, '响应缺少 list 数组');
    }

    return result(true, '接口响应正常');
  } catch (error) {
    if (timedOut || (error as Error).name === 'AbortError') {
      return result(false, '请求超时');
    }
    return result(false, '请求失败');
  } finally {
    clearTimeout(timeout);
  }
}
