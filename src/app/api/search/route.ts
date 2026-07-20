import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  filterAccessibleSources,
  getCurrentAdultAccess,
} from '@/lib/source-access';
import { matchesAdultKeyword } from '@/lib/adult-keywords';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const config = await getConfig();
  const hasAdultAccess = await getCurrentAdultAccess(request as never);
  const apiSites = filterAccessibleSources(
    config.SourceConfig.filter((site) => !site.disabled),
    hasAdultAccess
  );
  const searchPromises = apiSites.map((site) => searchFromApi(site, query));

  try {
    const results = await Promise.all(searchPromises);
    let flattenedResults = results.flat();
    if (!hasAdultAccess) {
      flattenedResults = flattenedResults.filter(
        (result) =>
          !matchesAdultKeyword(result, config.SiteConfig.AdultKeywords)
      );
    }
    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
