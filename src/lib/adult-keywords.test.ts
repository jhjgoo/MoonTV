import {
  DEFAULT_ADULT_KEYWORDS,
  matchesAdultKeyword,
  normalizeAdultKeywords,
} from './adult-keywords';

describe('adult content keywords', () => {
  test('ships the existing yellow words and newly required title keywords', () => {
    expect(DEFAULT_ADULT_KEYWORDS).toEqual(
      expect.arrayContaining(['伦理片', '金瓶梅', '三级片', '成人片'])
    );
  });

  test('trims and de-duplicates keywords without changing first display value', () => {
    expect(
      normalizeAdultKeywords([' 金瓶梅 ', '金瓶梅', 'AV女优', 'av女优', '', '  '])
    ).toEqual(['金瓶梅', 'AV女优']);
  });

  test.each([
    [{ title: '新金瓶梅', type_name: '', desc: '' }],
    [{ title: '普通电影', type_name: '三级片', desc: '' }],
    [{ title: '普通电影', type_name: '', desc: '包含成人片相关介绍' }],
  ])('matches a keyword in any content field: %p', (content) => {
    expect(matchesAdultKeyword(content, ['金瓶梅', '三级片', '成人片'])).toBe(
      true
    );
  });

  test('does not match source metadata or a regular content item', () => {
    expect(
      matchesAdultKeyword(
        { title: '普通电影', type_name: '剧情', desc: '正常简介' },
        ['金瓶梅']
      )
    ).toBe(false);
  });
});
