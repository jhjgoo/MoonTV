import {
  TextDecoder as NodeTextDecoder,
  TextEncoder as NodeTextEncoder,
} from 'util';

import { fetchTextWithLimits } from './source-fetch';

Object.assign(globalThis, {
  TextDecoder: NodeTextDecoder,
  TextEncoder: NodeTextEncoder,
});

interface StubResponseOptions {
  status?: number;
  location?: string;
  chunks?: Uint8Array[];
}

function createStubResponse({
  status = 200,
  location,
  chunks = [],
}: StubResponseOptions = {}) {
  let index = 0;
  const reader = {
    read: jest.fn(async () => {
      const value = chunks[index++];
      return value ? { done: false, value } : { done: true, value: undefined };
    }),
    cancel: jest.fn(async () => undefined),
  };
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'location' ? location || null : null,
    },
    body: { getReader: () => reader },
  } as unknown as Response;

  return { response, reader };
}

const encoder = new NodeTextEncoder();

describe('bounded source fetch', () => {
  test('follows manually validated redirects and reads streamed text', async () => {
    const redirect = createStubResponse({
      status: 302,
      location: '/subscription',
    });
    const terminal = createStubResponse({
      chunks: [encoder.encode('hello '), encoder.encode('world')],
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(redirect.response)
      .mockResolvedValueOnce(terminal.response);

    await expect(
      fetchTextWithLimits('https://example.com/start', { fetchImpl })
    ).resolves.toBe('hello world');
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://example.com/start',
      expect.objectContaining({ redirect: 'manual' })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://example.com/subscription',
      expect.objectContaining({ redirect: 'manual' })
    );
  });

  test('rejects an unsafe redirect before requesting it', async () => {
    const redirect = createStubResponse({
      status: 302,
      location: 'https://127.0.0.1/private',
    });
    const fetchImpl = jest.fn().mockResolvedValue(redirect.response);

    await expect(
      fetchTextWithLimits('https://example.com/start', { fetchImpl })
    ).rejects.toThrow('公网');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('rejects redirects beyond the configured limit', async () => {
    const fetchImpl = jest.fn(
      async () =>
        createStubResponse({ status: 302, location: '/again' }).response
    );

    await expect(
      fetchTextWithLimits('https://example.com/start', {
        fetchImpl,
        maxRedirects: 3,
      })
    ).rejects.toThrow('重定向');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test('rejects non-success terminal responses', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(createStubResponse({ status: 503 }).response);

    await expect(
      fetchTextWithLimits('https://example.com/start', { fetchImpl })
    ).rejects.toThrow('503');
  });

  test('cancels the reader as soon as the byte limit is exceeded', async () => {
    const oversized = createStubResponse({
      chunks: [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
        new Uint8Array([7]),
      ],
    });
    const fetchImpl = jest.fn().mockResolvedValue(oversized.response);

    await expect(
      fetchTextWithLimits('https://example.com/start', {
        fetchImpl,
        maxBytes: 4,
      })
    ).rejects.toThrow('过大');
    expect(oversized.reader.read).toHaveBeenCalledTimes(2);
    expect(oversized.reader.cancel).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(
      true
    );
  });

  test('rejects response bytes that are not valid UTF-8', async () => {
    const invalid = createStubResponse({
      chunks: [new Uint8Array([0xff])],
    });
    const fetchImpl = jest.fn().mockResolvedValue(invalid.response);

    await expect(
      fetchTextWithLimits('https://example.com/start', { fetchImpl })
    ).rejects.toThrow('UTF-8');
  });

  test('aborts a request after the timeout', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const request = fetchTextWithLimits('https://example.com/start', {
      fetchImpl,
      timeoutMs: 10_000,
    });
    jest.advanceTimersByTime(10_000);

    await expect(request).rejects.toThrow('超时');
    jest.useRealTimers();
  });
});
