/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { checkSourceHealth } from '@/lib/source-health';

export const runtime = 'edge';

interface CheckBody {
  key?: unknown;
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
    const body = (await request.json()) as CheckBody;
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (typeof body.key !== 'string' || !body.key) {
      return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
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

    const source = adminConfig.SourceConfig.find(
      (candidate) => candidate.key === body.key
    );
    if (!source) {
      return NextResponse.json({ error: '源不存在' }, { status: 404 });
    }

    const result = await checkSourceHealth(source);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('视频源检测失败:', error);
    return NextResponse.json({ error: '视频源检测失败' }, { status: 500 });
  }
}
