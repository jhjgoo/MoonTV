import { NextResponse } from 'next/server';

import { matchesAdultKeyword } from '@/lib/adult-keywords';
import { getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  ADULT_ACCESS_DENIED_MESSAGE,
  assertSourceAccessible,
  getCurrentAdultAccess,
} from '@/lib/source-access';

export const runtime = 'edge';

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');

  if (!query || !resourceId) {
    return NextResponse.json(
      { result: null, error: '缺少必要参数: q 或 resourceId' },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = config.SourceConfig.filter((site) => !site.disabled);

  try {
    // 根据 resourceId 查找对应的 API 站点
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return NextResponse.json(
        {
          error: `未找到指定的视频源: ${resourceId}`,
          result: null,
        },
        { status: 404 }
      );
    }

    const hasAdultAccess = await getCurrentAdultAccess(request as never);
    try {
      assertSourceAccessible(targetSite, hasAdultAccess);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === ADULT_ACCESS_DENIED_MESSAGE
      ) {
        return NextResponse.json(
          { error: ADULT_ACCESS_DENIED_MESSAGE, result: null },
          { status: 403 }
        );
      }
      throw error;
    }

    const results = await searchFromApi(targetSite, query);
    const result = results.filter((r) => r.title === query);
    if (
      !hasAdultAccess &&
      result.some((item) =>
        matchesAdultKeyword(item, config.SiteConfig.AdultKeywords)
      )
    ) {
      return NextResponse.json(
        { error: ADULT_ACCESS_DENIED_MESSAGE, result: null },
        { status: 403 }
      );
    }
    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到结果',
          result: null,
        },
        { status: 404 }
      );
    } else {
      return NextResponse.json(
        { results: result },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: '搜索失败',
        result: null,
      },
      { status: 500 }
    );
  }
}
