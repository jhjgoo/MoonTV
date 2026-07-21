import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { UserMenu } from './UserMenu';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(() => ({
    username: 'tester',
    role: 'user',
  })),
}));

jest.mock('@/lib/version', () => ({
  checkForUpdates: jest.fn().mockResolvedValue('NO_UPDATE'),
  CURRENT_VERSION: '0.0.0',
  UpdateStatus: {
    HAS_UPDATE: 'HAS_UPDATE',
    NO_UPDATE: 'NO_UPDATE',
    FETCH_FAILED: 'FETCH_FAILED',
  },
}));

async function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'User Menu' }));
  fireEvent.click(await screen.findByRole('button', { name: '设置' }));

  return screen.findByRole('group', { name: '默认播放器' });
}

describe('UserMenu player preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('stores Vidstack when the Vidstack option is selected', async () => {
    render(<UserMenu />);
    await openSettings();

    fireEvent.click(
      screen.getByRole('radio', { name: 'Vidstack（实验性）' })
    );

    expect(localStorage.getItem('preferredPlayer')).toBe('vidstack');
  });

  test('keeps the selected player checked after closing and reopening settings', async () => {
    render(<UserMenu />);
    await openSettings();

    fireEvent.click(
      screen.getByRole('radio', { name: 'Vidstack（实验性）' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: '默认播放器' })
      ).not.toBeInTheDocument()
    );
    await openSettings();

    expect(
      screen.getByRole('radio', { name: 'Vidstack（实验性）' })
    ).toBeChecked();
  });

  test('resets an existing Vidstack preference to ArtPlayer', async () => {
    localStorage.setItem('preferredPlayer', 'vidstack');
    render(<UserMenu />);
    await openSettings();

    expect(
      screen.getByRole('radio', { name: 'Vidstack（实验性）' })
    ).toBeChecked();

    fireEvent.click(screen.getByTitle('重置为默认设置'));

    expect(
      screen.getByRole('radio', { name: 'ArtPlayer（默认）' })
    ).toBeChecked();
    expect(localStorage.getItem('preferredPlayer')).toBe('artplayer');
  });
});
