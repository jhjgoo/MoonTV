import { processImageUrl } from './utils';

const doubanPoster =
  'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2934049524.jpg';

describe('processImageUrl', () => {
  beforeEach(() => {
    localStorage.clear();
    (
      window as typeof window & { RUNTIME_CONFIG?: { IMAGE_PROXY?: string } }
    ).RUNTIME_CONFIG = { IMAGE_PROXY: '' };
  });

  test('uses the built-in proxy for Douban images when no custom proxy is configured', () => {
    expect(processImageUrl(doubanPoster)).toBe(
      `/api/image-proxy?url=${encodeURIComponent(doubanPoster)}`
    );
  });

  test('prefers an enabled custom image proxy', () => {
    localStorage.setItem('enableImageProxy', 'true');
    localStorage.setItem('imageProxyUrl', 'https://proxy.example/?url=');

    expect(processImageUrl(doubanPoster)).toBe(
      `https://proxy.example/?url=${encodeURIComponent(doubanPoster)}`
    );
  });

  test('uses the runtime custom image proxy when no local preference exists', () => {
    (
      window as typeof window & { RUNTIME_CONFIG?: { IMAGE_PROXY?: string } }
    ).RUNTIME_CONFIG = { IMAGE_PROXY: 'https://runtime-proxy.example/?url=' };

    expect(processImageUrl(doubanPoster)).toBe(
      `https://runtime-proxy.example/?url=${encodeURIComponent(doubanPoster)}`
    );
  });

  test('keeps using the built-in proxy for Douban images when the global proxy is disabled', () => {
    localStorage.setItem('enableImageProxy', 'false');
    localStorage.setItem(
      'imageProxyUrl',
      'https://disabled-proxy.example/?url='
    );

    expect(processImageUrl(doubanPoster)).toBe(
      `/api/image-proxy?url=${encodeURIComponent(doubanPoster)}`
    );
  });

  test('uses the built-in proxy for protocol-relative Douban images', () => {
    const protocolRelativePoster =
      '//img9.doubanio.com/view/photo/s_ratio_poster/public/p2934049524.jpg';

    expect(processImageUrl(protocolRelativePoster)).toBe(
      `/api/image-proxy?url=${encodeURIComponent(protocolRelativePoster)}`
    );
  });

  test('keeps non-Douban images direct when no custom proxy is configured', () => {
    const poster = 'https://example.com/poster.jpg';

    expect(processImageUrl(poster)).toBe(poster);
  });
});
