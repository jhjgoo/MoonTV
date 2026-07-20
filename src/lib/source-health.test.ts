import { checkSourceHealth } from './source-health';

const source = {
  key: 'demo',
  name: 'Demo',
  api: 'https://example.com/api',
  adult: false,
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('source health probe', () => {
  test.each([[[]], [[{ vod_id: 1 }]]])(
    'treats a 2xx response with list %p as healthy',
    async (list) => {
      const fetchImpl = jest.fn().mockResolvedValue(response({ list }));
      const now = jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(100)
        .mockReturnValue(125);

      await expect(checkSourceHealth(source, fetchImpl)).resolves.toEqual({
        healthy: true,
        latencyMs: 25,
        message: '接口响应正常',
      });
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://example.com/api?ac=videolist&wd=%E6%B5%8B%E8%AF%95',
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: 'application/json' }),
          signal: expect.anything(),
        })
      );
      now.mockRestore();
    }
  );

  test('converts non-2xx responses into an unhealthy result', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({}, 503));

    await expect(checkSourceHealth(source, fetchImpl)).resolves.toMatchObject({
      healthy: false,
      message: '上游返回 HTTP 503',
    });
  });

  test('converts invalid JSON into an unhealthy result', async () => {
    const invalid = response({});
    (invalid.json as jest.Mock).mockRejectedValue(new SyntaxError('invalid'));

    await expect(
      checkSourceHealth(source, jest.fn().mockResolvedValue(invalid))
    ).resolves.toMatchObject({
      healthy: false,
      message: '响应不是合法 JSON',
    });
  });

  test.each([{}, { list: null }, { list: {} }, { list: 'items' }])(
    'rejects a response without an array list: %p',
    async (body) => {
      await expect(
        checkSourceHealth(source, jest.fn().mockResolvedValue(response(body)))
      ).resolves.toMatchObject({
        healthy: false,
        message: '响应缺少 list 数组',
      });
    }
  );

  test('aborts and reports a request timeout after eight seconds', async () => {
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

    const check = checkSourceHealth(source, fetchImpl);
    jest.advanceTimersByTime(8_000);

    await expect(check).resolves.toMatchObject({
      healthy: false,
      message: '请求超时',
    });
    jest.useRealTimers();
  });

  test('converts network failures into an unhealthy result', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(checkSourceHealth(source, fetchImpl)).resolves.toMatchObject({
      healthy: false,
      message: '请求失败',
    });
  });
});
