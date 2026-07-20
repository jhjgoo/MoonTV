import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

import { POST } from './route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init: { status?: number } = {}) => ({
      status: init.status || 200,
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ getStorage: jest.fn() }));

const mockAuth = getAuthInfoFromCookie as jest.MockedFunction<
  typeof getAuthInfoFromCookie
>;
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;
const mockGetStorage = getStorage as jest.MockedFunction<typeof getStorage>;

function config() {
  return {
    SiteConfig: { AdultKeywords: ['三级片'] },
    UserConfig: {
      Users: [
        { username: 'owner', role: 'owner' as const },
        { username: 'admin', role: 'admin' as const },
        { username: 'user', role: 'user' as const },
      ],
    },
  };
}

describe('POST /api/admin/adult-keyword', () => {
  const setAdminConfig = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
    mockGetStorage.mockReturnValue({ setAdminConfig } as never);
    mockGetConfig.mockResolvedValue(config() as never);
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    delete process.env.USERNAME;
  });

  test('allows an admin to add, edit and delete a keyword', async () => {
    const adminConfig = config();
    mockGetConfig.mockResolvedValue(adminConfig as never);
    mockAuth.mockReturnValue({ username: 'admin' } as never);

    expect(
      (
        await POST({
          json: async () => ({ action: 'add', keyword: ' 金瓶梅 ' }),
        } as never)
      ).status
    ).toBe(200);
    expect(adminConfig.SiteConfig.AdultKeywords).toContain('金瓶梅');

    expect(
      (
        await POST({
          json: async () => ({
            action: 'update',
            keyword: '金瓶梅',
            nextKeyword: '新金瓶梅',
          }),
        } as never)
      ).status
    ).toBe(200);
    expect(adminConfig.SiteConfig.AdultKeywords).toContain('新金瓶梅');

    expect(
      (
        await POST({
          json: async () => ({ action: 'delete', keyword: '新金瓶梅' }),
        } as never)
      ).status
    ).toBe(200);
    expect(adminConfig.SiteConfig.AdultKeywords).not.toContain('新金瓶梅');
  });

  test('rejects duplicate keywords and regular users', async () => {
    mockAuth.mockReturnValue({ username: 'admin' } as never);
    expect(
      (
        await POST({
          json: async () => ({ action: 'add', keyword: '三级片' }),
        } as never)
      ).status
    ).toBe(400);

    mockAuth.mockReturnValue({ username: 'user' } as never);
    expect(
      (
        await POST({
          json: async () => ({ action: 'add', keyword: '金瓶梅' }),
        } as never)
      ).status
    ).toBe(401);
  });
});
