/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { normalizeAdultKeywords } from '@/lib/adult-keywords';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

export const runtime = 'edge';

const ACTIONS = ['add', 'update', 'delete'] as const;

function normalizedKeyword(value: unknown): string | null {
  const keywords = normalizeAdultKeywords([value]);
  return keywords[0] || null;
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
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo?.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action, keyword, nextKeyword } = body as {
      action?: (typeof ACTIONS)[number];
      keyword?: unknown;
      nextKeyword?: unknown;
    };
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const adminConfig = await getConfig();
    const isOwner = authInfo.username === process.env.USERNAME;
    const user = adminConfig.UserConfig.Users.find(
      (entry) => entry.username === authInfo.username
    );
    if (!isOwner && user?.role !== 'admin') {
      return NextResponse.json({ error: '权限不足' }, { status: 401 });
    }

    const current = normalizeAdultKeywords(adminConfig.SiteConfig.AdultKeywords);
    const normalized = normalizedKeyword(keyword);
    if (!normalized) {
      return NextResponse.json({ error: '关键词不能为空' }, { status: 400 });
    }
    const currentIndex = current.findIndex(
      (item) => item.toLocaleLowerCase() === normalized.toLocaleLowerCase()
    );

    if (action === 'add') {
      if (currentIndex !== -1) {
        return NextResponse.json({ error: '关键词已存在' }, { status: 400 });
      }
      current.push(normalized);
    }

    if (action === 'update') {
      if (currentIndex === -1) {
        return NextResponse.json({ error: '关键词不存在' }, { status: 404 });
      }
      const replacement = normalizedKeyword(nextKeyword);
      if (!replacement) {
        return NextResponse.json({ error: '关键词不能为空' }, { status: 400 });
      }
      const duplicateIndex = current.findIndex(
        (item) => item.toLocaleLowerCase() === replacement.toLocaleLowerCase()
      );
      if (duplicateIndex !== -1 && duplicateIndex !== currentIndex) {
        return NextResponse.json({ error: '关键词已存在' }, { status: 400 });
      }
      current[currentIndex] = replacement;
    }

    if (action === 'delete') {
      if (currentIndex === -1) {
        return NextResponse.json({ error: '关键词不存在' }, { status: 404 });
      }
      current.splice(currentIndex, 1);
    }

    adminConfig.SiteConfig.AdultKeywords = normalizeAdultKeywords(current);
    const storage = getStorage();
    if (storage && typeof (storage as any).setAdminConfig === 'function') {
      await (storage as any).setAdminConfig(adminConfig);
    }
    return NextResponse.json(
      { ok: true, keywords: adminConfig.SiteConfig.AdultKeywords },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: '关键词配置操作失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
