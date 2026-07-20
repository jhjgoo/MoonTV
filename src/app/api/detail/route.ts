import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import {
  ADULT_ACCESS_DENIED_MESSAGE,
  assertSourceAccessible,
  getCurrentAdultAccess,
} from '@/lib/source-access';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID格式' }, { status: 400 });
  }

  try {
    const config = await getConfig();
    const apiSites = config.SourceConfig.filter((site) => !site.disabled);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '无效的API来源' }, { status: 400 });
    }

    try {
      assertSourceAccessible(
        apiSite,
        await getCurrentAdultAccess(request as never)
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === ADULT_ACCESS_DENIED_MESSAGE
      ) {
        return NextResponse.json(
          { error: ADULT_ACCESS_DENIED_MESSAGE },
          { status: 403 }
        );
      }
      throw error;
    }

    const result = await getDetailFromApi(apiSite, id);
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
