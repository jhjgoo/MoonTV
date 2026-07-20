const LEGACY_YELLOW_KEYWORDS = [
  '伦理片',
  '福利',
  '里番动漫',
  '门事件',
  '萝莉少女',
  '制服诱惑',
  '国产传媒',
  'cosplay',
  '黑丝诱惑',
  '无码',
  '日本无码',
  '有码',
  '日本有码',
  'SWAG',
  '网红主播',
  '色情片',
  '同性片',
  '福利视频',
  '福利片',
  '写真热舞',
];

const ADDED_ADULT_KEYWORDS = [
  '金瓶梅',
  '三级片',
  '成人片',
  '成人影片',
  '成人内容',
  '18禁',
  '限制级',
  'A片',
  'H动漫',
  'H漫画',
  '黄色电影',
  '情色',
  '性爱',
  '性爱片',
  '性欲',
  '色欲',
  '淫乱',
  '淫荡',
  '淫欲',
  '里番',
  'AV片',
  'AV女优',
];

export const DEFAULT_ADULT_KEYWORDS = normalizeAdultKeywords([
  ...LEGACY_YELLOW_KEYWORDS,
  ...ADDED_ADULT_KEYWORDS,
]);

export function normalizeAdultKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) {
    return [];
  }

  const seen = new Set<string>();
  return keywords.flatMap((keyword) => {
    if (typeof keyword !== 'string') {
      return [];
    }
    const normalized = keyword.trim();
    const comparison = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(comparison)) {
      return [];
    }
    seen.add(comparison);
    return [normalized];
  });
}

export function matchesAdultKeyword(
  content: Pick<
    { title?: string; type_name?: string; desc?: string },
    'title' | 'type_name' | 'desc'
  >,
  keywords: string[]
): boolean {
  const searchableText = [content.title, content.type_name, content.desc]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLocaleLowerCase();

  return normalizeAdultKeywords(keywords).some((keyword) =>
    searchableText.includes(keyword.toLocaleLowerCase())
  );
}
