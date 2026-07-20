/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { matchesAdultKeyword } from '@/lib/adult-keywords';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  ADULT_ACCESS_DENIED_MESSAGE,
  canAccessSource,
  getCurrentAdultAccess,
} from '@/lib/source-access';
import { PlayRecord } from '@/lib/types';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [records, config, hasAdultAccess] = await Promise.all([
      db.getAllPlayRecords(authInfo.username),
      getConfig(),
      getCurrentAdultAccess(request),
    ]);
    const accessibleRecords = Object.fromEntries(
      Object.entries(records).filter(([recordKey, record]) => {
        const [source] = recordKey.split('+');
        return (
          source &&
          canAccessSource(
            config.SourceConfig.find((site) => site.key === source),
            hasAdultAccess
          ) &&
          (hasAdultAccess ||
            !matchesAdultKeyword(record, config.SiteConfig.AdultKeywords))
        );
      })
    );
    return NextResponse.json(accessibleRecords, { status: 200 });
  } catch (err) {
    console.error('获取播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 }
      );
    }

    // 验证播放记录数据
    if (!record.title || !record.source_name || record.index < 1) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 }
      );
    }

    // 从key中解析source和id
    const [source, id] = key.split('+');
    if (!source || !id) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const hasAdultAccess = await getCurrentAdultAccess(request);
    const site = config.SourceConfig.find((entry) => entry.key === source);
    if (
      !canAccessSource(site, hasAdultAccess) ||
      (!hasAdultAccess &&
        matchesAdultKeyword(record, config.SiteConfig.AdultKeywords))
    ) {
      return NextResponse.json(
        { error: ADULT_ACCESS_DENIED_MESSAGE },
        { status: 403 }
      );
    }

    const finalRecord = {
      ...record,
      save_time: record.save_time ?? Date.now(),
    } as PlayRecord;

    await db.savePlayRecord(authInfo.username, source, id, finalRecord);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('保存播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 如果提供了 key，删除单条播放记录
      const [source, id] = key.split('+');
      if (!source || !id) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }

      await db.deletePlayRecord(username, source, id);
    } else {
      // 未提供 key，则清空全部播放记录
      // 目前 DbManager 没有对应方法，这里直接遍历删除
      const all = await db.getAllPlayRecords(username);
      await Promise.all(
        Object.keys(all).map(async (k) => {
          const [s, i] = k.split('+');
          if (s && i) await db.deletePlayRecord(username, s, i);
        })
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
