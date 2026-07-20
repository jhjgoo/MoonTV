/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { fetchTextWithLimits } from '@/lib/source-fetch';
import { parseSourceSubscription } from '@/lib/source-subscription';
import { IStorage } from '@/lib/types';

export const runtime = 'edge';

interface SubscriptionBody {
  url?: unknown;
}

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存储进行管理员配置' },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as SubscriptionBody;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (typeof body.url !== 'string' || !body.url.trim()) {
      return NextResponse.json({ error: '订阅 URL 不能为空' }, { status: 400 });
    }

    const adminConfig = await getConfig();
    const username = authInfo.username;
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (user) => user.username === username
      );
      if (!userEntry || userEntry.role !== 'admin') {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    const encoded = await fetchTextWithLimits(body.url.trim(), {
      maxBytes: 1024 * 1024,
    });
    const existingKeys = new Set(
      adminConfig.SourceConfig.map((source) => source.key)
    );
    const result = parseSourceSubscription(
      encoded,
      existingKeys,
      adminConfig.SourceConfig.length
    );

    if (result.added > 0) {
      const storage: IStorage | null = getStorage();
      if (!storage) {
        throw new Error('管理员配置存储不可用');
      }
      const nextSources = [...adminConfig.SourceConfig, ...result.sources];
      await storage.setAdminConfig({
        ...adminConfig,
        SourceConfig: nextSources,
      });
      adminConfig.SourceConfig = nextSources;
    }

    return NextResponse.json(
      {
        ok: true,
        added: result.added,
        skipped: result.skipped,
        failed: result.failed,
        skippedItems: result.skippedItems,
        failedItems: result.failedItems,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('订阅导入失败:', error);
    return NextResponse.json({ error: '订阅导入失败' }, { status: 400 });
  }
}
