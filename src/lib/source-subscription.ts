import type { AdminSource } from './source.types';
import { normalizeAdminSource } from './source-normalization';
import { validatePublicHttpsUrl } from './source-url';

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAX_SUBSCRIPTION_ITEMS = 500;
const MAX_TOTAL_SOURCES = 1000;
const MAX_KEY_OR_NAME_LENGTH = 128;
const MAX_URL_LENGTH = 2048;
const MAX_RESULT_DETAILS = 20;

export interface SubscriptionFailure {
  key: string;
  reason: string;
}

export interface SubscriptionImportResult {
  sources: AdminSource[];
  added: number;
  skipped: number;
  failed: number;
  skippedItems: SubscriptionFailure[];
  failedItems: SubscriptionFailure[];
}

function decodeBase58(encoded: string): Uint8Array {
  const value = encoded.trim();
  if (!value) {
    throw new Error('订阅内容不能为空');
  }

  let leadingZeros = 0;
  while (leadingZeros < value.length && value[leadingZeros] === '1') {
    leadingZeros += 1;
  }

  const bytes: number[] = [];
  for (let index = leadingZeros; index < value.length; index++) {
    let carry = BASE58_ALPHABET.indexOf(value[index]);
    if (carry < 0) {
      throw new Error('订阅内容包含非法 Base58 字符');
    }
    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
      carry += bytes[byteIndex] * 58;
      bytes[byteIndex] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const decoded = new Uint8Array(leadingZeros + bytes.length);
  for (let index = 0; index < bytes.length; index++) {
    decoded[decoded.length - 1 - index] = bytes[index];
  }
  return decoded;
}

function parsePayload(encoded: string): Record<string, unknown> {
  const bytes = decodeBase58(encoded);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Base58 解码结果不是有效的 UTF-8 文本');
  }
  if (!text.trim()) {
    throw new Error('订阅内容不能为空');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('订阅内容不是合法 JSON');
  }
  if (!isRecord(payload)) {
    throw new Error('订阅 JSON 顶层结构无效');
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function itemFailureKey(rawKey: string): string {
  return rawKey.trim() || rawKey;
}

export function parseSourceSubscription(
  encoded: string,
  existingKeys: ReadonlySet<string>,
  existingCount: number
): SubscriptionImportResult {
  const payload = parsePayload(encoded);
  if (!isRecord(payload.api_site)) {
    throw new Error('订阅内容缺少合法的 api_site 对象');
  }

  const entries = Object.entries(payload.api_site);
  if (entries.length > MAX_SUBSCRIPTION_ITEMS) {
    throw new Error(`单个订阅最多包含 ${MAX_SUBSCRIPTION_ITEMS} 个视频源`);
  }

  const sources: AdminSource[] = [];
  const skippedItems: SubscriptionFailure[] = [];
  const failedItems: SubscriptionFailure[] = [];
  const seenKeys = new Set(existingKeys);
  let skipped = 0;
  let failed = 0;

  const recordFailure = (key: string, reason: string) => {
    failed += 1;
    if (failedItems.length < MAX_RESULT_DETAILS) {
      failedItems.push({ key, reason });
    }
  };

  for (const [rawKey, rawSource] of entries) {
    const key = rawKey.trim();
    const failureKey = itemFailureKey(rawKey);
    if (!key) {
      recordFailure(failureKey, 'Key 不能为空');
      continue;
    }
    if (key.length > MAX_KEY_OR_NAME_LENGTH) {
      recordFailure(failureKey, 'Key 长度不能超过 128');
      continue;
    }
    if (seenKeys.has(key)) {
      skipped += 1;
      if (skippedItems.length < MAX_RESULT_DETAILS) {
        skippedItems.push({ key, reason: 'duplicate' });
      }
      continue;
    }
    if (!isRecord(rawSource)) {
      recordFailure(key, '视频源条目必须是对象');
      continue;
    }

    const name =
      typeof rawSource.name === 'string' ? rawSource.name.trim() : '';
    const api = typeof rawSource.api === 'string' ? rawSource.api.trim() : '';
    if (!name) {
      recordFailure(key, '名称不能为空');
      continue;
    }
    if (name.length > MAX_KEY_OR_NAME_LENGTH) {
      recordFailure(key, '名称长度不能超过 128');
      continue;
    }
    if (!api) {
      recordFailure(key, 'API URL 不能为空');
      continue;
    }
    if (api.length > MAX_URL_LENGTH) {
      recordFailure(key, 'API URL 长度不能超过 2048');
      continue;
    }

    let detail: string | undefined;
    if (rawSource.detail !== undefined && rawSource.detail !== null) {
      if (typeof rawSource.detail !== 'string') {
        recordFailure(key, 'Detail URL 格式不正确');
        continue;
      }
      detail = rawSource.detail.trim() || undefined;
      if (detail && detail.length > MAX_URL_LENGTH) {
        recordFailure(key, 'Detail URL 长度不能超过 2048');
        continue;
      }
    }

    try {
      validatePublicHttpsUrl(api, MAX_URL_LENGTH);
      if (detail) validatePublicHttpsUrl(detail, MAX_URL_LENGTH);
    } catch (error) {
      recordFailure(key, (error as Error).message);
      continue;
    }

    sources.push(
      normalizeAdminSource({
        key,
        name,
        api,
        detail,
        adult: rawSource.adult,
        from: 'custom',
        disabled: false,
      })
    );
    seenKeys.add(key);
  }

  if (existingCount + sources.length > MAX_TOTAL_SOURCES) {
    throw new Error(`合并后的视频源总数不能超过 ${MAX_TOTAL_SOURCES}`);
  }

  return {
    sources,
    added: sources.length,
    skipped,
    failed,
    skippedItems,
    failedItems,
  };
}
