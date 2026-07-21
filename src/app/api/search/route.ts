import { NextResponse } from 'next/server';

import { matchesAdultKeyword } from '@/lib/adult-keywords';
import { getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import {
  filterAccessibleSources,
  getCurrentAdultAccess,
} from '@/lib/source-access';

export const runtime = 'edge';

const CLOUDFLARE_SAFE_SUBREQUEST_BUDGET = 40;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const requestedPage = Number.parseInt(searchParams.get('page') || '0', 10);
  const page =
    Number.isFinite(requestedPage) && requestedPage >= 0 ? requestedPage : 0;

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
  const accessibleSites = filterAccessibleSources(
    config.SourceConfig.filter((site) => !site.disabled),
    hasAdultAccess
  );
  const maxPagesPerSource = Math.max(
    1,
    Math.min(
      CLOUDFLARE_SAFE_SUBREQUEST_BUDGET,
      Math.floor(config.SiteConfig.SearchDownstreamMaxPage || 1)
    )
  );
  const batchSize = Math.max(
    1,
    Math.floor(CLOUDFLARE_SAFE_SUBREQUEST_BUDGET / maxPagesPerSource)
  );
  const totalPages = Math.max(1, Math.ceil(accessibleSites.length / batchSize));
  const apiSites = accessibleSites.slice(
    page * batchSize,
    (page + 1) * batchSize
  );
  const searchPromises = apiSites.map((site) =>
    searchFromApi(site, query, maxPagesPerSource)
  );

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
      { results: flattenedResults, totalPages },
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
