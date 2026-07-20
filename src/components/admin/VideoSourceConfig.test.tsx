import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { AdminConfig } from '@/lib/admin.types';

import VideoSourceConfig from './VideoSourceConfig';

jest.mock('@dnd-kit/core', () => ({
  closestCenter: jest.fn(),
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  PointerSensor: jest.fn(),
  TouchSensor: jest.fn(),
  useSensor: jest.fn(() => ({})),
  useSensors: jest.fn(() => []),
}));
jest.mock('@dnd-kit/modifiers', () => ({
  restrictToParentElement: jest.fn(),
  restrictToVerticalAxis: jest.fn(),
}));
jest.mock('@dnd-kit/sortable', () => ({
  arrayMove: (items: unknown[]) => items,
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  useSortable: jest.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
  })),
  verticalListSortingStrategy: jest.fn(),
}));
jest.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: jest.fn(() => undefined) } },
}));
jest.mock('sweetalert2', () => ({
  fire: jest.fn(),
}));

function createConfig(): AdminConfig {
  return {
    SiteConfig: {
      SiteName: 'MoonTV',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      ImageProxy: '',
      DoubanProxy: '',
      DisableYellowFilter: false,
    },
    UserConfig: { AllowRegister: false, Users: [] },
    SourceConfig: [
      {
        key: 'adult-source',
        name: 'Adult source',
        api: 'https://adult.example.com/api',
        adult: true,
        from: 'custom',
        disabled: false,
      },
      {
        key: 'general-source',
        name: 'General source',
        api: 'https://general.example.com/api',
        adult: false,
        from: 'config',
        disabled: false,
      },
    ],
    CustomCategories: [],
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('VideoSourceConfig', () => {
  const refreshConfig = jest.fn().mockResolvedValue(undefined);
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
  });

  test('keeps add and subscription forms mutually exclusive', () => {
    render(
      <VideoSourceConfig
        config={createConfig()}
        refreshConfig={refreshConfig}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '添加视频源' }));
    expect(screen.getByPlaceholderText('名称')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: '🔞 成人内容源' })
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '添加订阅链接' }));
    expect(screen.queryByPlaceholderText('名称')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('订阅链接')).toBeInTheDocument();
  });

  test('submits strict adult metadata when adding one source', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    render(
      <VideoSourceConfig
        config={createConfig()}
        refreshConfig={refreshConfig}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '添加视频源' }));
    fireEvent.change(screen.getByPlaceholderText('名称'), {
      target: { value: 'Demo' },
    });
    fireEvent.change(screen.getByPlaceholderText('Key'), {
      target: { value: 'demo' },
    });
    fireEvent.change(screen.getByPlaceholderText('API 地址'), {
      target: { value: 'https://example.com/api' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '🔞 成人内容源' }));
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(refreshConfig).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/source',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'add',
          key: 'demo',
          name: 'Demo',
          api: 'https://example.com/api',
          detail: '',
          adult: true,
        }),
      })
    );
  });

  test('shows subscription loading and import summary', async () => {
    let resolveRequest: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      })
    );
    render(
      <VideoSourceConfig
        config={createConfig()}
        refreshConfig={refreshConfig}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '添加订阅链接' }));
    fireEvent.change(screen.getByPlaceholderText('订阅链接'), {
      target: { value: 'https://subscription.example.com/full' },
    });
    fireEvent.click(screen.getByRole('button', { name: '解析并导入' }));

    expect(screen.getByRole('button', { name: '导入中…' })).toBeDisabled();
    await act(async () => {
      resolveRequest(
        jsonResponse({
          ok: true,
          added: 2,
          skipped: 1,
          failed: 1,
          skippedItems: [{ key: 'existing', reason: 'duplicate' }],
          failedItems: [{ key: 'bad', reason: '名称不能为空' }],
        })
      );
    });

    expect(
      await screen.findByText('新增 2，跳过 1，失败 1')
    ).toBeInTheDocument();
    expect(screen.getByText('existing：duplicate')).toBeInTheDocument();
    expect(screen.getByText('bad：名称不能为空')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/source/subscription',
      expect.objectContaining({
        body: JSON.stringify({
          url: 'https://subscription.example.com/full',
        }),
      })
    );
  });

  test('renders adult badges and keeps health state transient', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ healthy: false, latencyMs: 8000, message: '请求超时' })
      )
      .mockResolvedValueOnce(
        jsonResponse({ healthy: true, latencyMs: 25, message: '接口响应正常' })
      );
    const config = createConfig();
    const originalSources = JSON.stringify(config.SourceConfig);
    const view = render(
      <VideoSourceConfig config={config} refreshConfig={refreshConfig} />
    );

    expect(screen.getByTitle('成人内容源')).toHaveTextContent('🔞');
    expect(screen.getAllByText('未检测')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[0]);
    expect(screen.getByRole('button', { name: '检测中…' })).toBeDisabled();
    expect(await screen.findByText('异常 · 请求超时')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
    expect(await screen.findByText('正常 · 25 ms')).toBeInTheDocument();
    expect(JSON.stringify(config.SourceConfig)).toBe(originalSources);

    view.unmount();
    render(<VideoSourceConfig config={config} refreshConfig={refreshConfig} />);
    expect(screen.getAllByText('未检测')).toHaveLength(2);
  });
});
