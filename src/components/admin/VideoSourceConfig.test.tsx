import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

  test('uses edit actions for custom sources and toggle actions for built-in sources', () => {
    render(
      <VideoSourceConfig
        config={createConfig()}
        refreshConfig={refreshConfig}
      />
    );

    expect(
      screen.getByRole('button', { name: '编辑 adult-source' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '禁用 adult-source' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '编辑 general-source' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '禁用 general-source' })
    ).toBeInTheDocument();
  });

  test('opens a prefilled edit dialog with a read-only key', async () => {
    render(
      <VideoSourceConfig
        config={createConfig()}
        refreshConfig={refreshConfig}
      />
    );
    const editButton = screen.getByRole('button', {
      name: '编辑 adult-source',
    });

    fireEvent.click(editButton);

    const dialog = screen.getByRole('dialog', { name: '编辑视频源' });
    const dialogQueries = within(dialog);
    const nameInput = dialogQueries.getByRole('textbox', { name: '名称' });
    expect(nameInput).toHaveValue('Adult source');
    expect(dialogQueries.getByRole('textbox', { name: 'Key' })).toHaveValue(
      'adult-source'
    );
    expect(dialogQueries.getByRole('textbox', { name: 'Key' })).toHaveAttribute(
      'readonly'
    );
    expect(
      dialogQueries.getByRole('textbox', { name: 'API 地址' })
    ).toHaveValue('https://adult.example.com/api');
    expect(
      dialogQueries.getByRole('textbox', { name: 'Detail 地址' })
    ).toHaveValue('');
    expect(
      dialogQueries.getByRole('checkbox', { name: '🔞 成人内容源' })
    ).toBeChecked();
    expect(
      dialogQueries.getByRole('checkbox', { name: '启用此视频源' })
    ).toBeChecked();
    await waitFor(() => expect(nameInput).toHaveFocus());
    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(
      dialogQueries.getByRole('button', { name: '保存修改' })
    ).toBeDisabled();

    fireEvent.click(dialogQueries.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '编辑 adult-source' })
      ).toHaveFocus()
    );
  });

  test('shows a disabled custom source as not enabled in the dialog', () => {
    const config = createConfig();
    config.SourceConfig[0].disabled = true;
    render(<VideoSourceConfig config={config} refreshConfig={refreshConfig} />);

    fireEvent.click(screen.getByRole('button', { name: '编辑 adult-source' }));

    expect(
      within(screen.getByRole('dialog')).getByRole('checkbox', {
        name: '启用此视频源',
      })
    ).not.toBeChecked();
  });

  test('does not steal focus while editing fields other than the name', () => {
    render(
      <VideoSourceConfig
        config={createConfig()}
        refreshConfig={refreshConfig}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑 adult-source' }));
    const dialog = screen.getByRole('dialog', { name: '编辑视频源' });
    const apiInput = within(dialog).getByRole('textbox', {
      name: 'API 地址',
    });
    apiInput.focus();

    fireEvent.change(apiInput, {
      target: { value: 'https://updated.example.com/api' },
    });

    expect(apiInput).toHaveFocus();
  });

  test('submits edited fields, prevents duplicates, and clears stale health state', async () => {
    let resolveUpdate: (response: Response) => void = () => undefined;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ healthy: true, latencyMs: 25, message: '接口响应正常' })
      )
      .mockResolvedValueOnce(
        jsonResponse({ healthy: true, latencyMs: 40, message: '接口响应正常' })
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveUpdate = resolve;
        })
      );
    const config = createConfig();
    const viewRef: { current?: ReturnType<typeof render> } = {};
    const refreshAfterEdit = jest.fn(async () => {
      viewRef.current?.rerender(
        <VideoSourceConfig
          config={{
            ...config,
            SourceConfig: config.SourceConfig.map((source) => ({ ...source })),
          }}
          refreshConfig={refreshAfterEdit}
        />
      );
    });
    viewRef.current = render(
      <VideoSourceConfig config={config} refreshConfig={refreshAfterEdit} />
    );

    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[0]);
    expect(await screen.findByText('正常 · 25 ms')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[1]);
    expect(await screen.findByText('正常 · 40 ms')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑 adult-source' }));
    const dialog = screen.getByRole('dialog', { name: '编辑视频源' });
    const dialogQueries = within(dialog);
    fireEvent.change(dialogQueries.getByRole('textbox', { name: '名称' }), {
      target: { value: 'Updated source' },
    });
    fireEvent.change(dialogQueries.getByRole('textbox', { name: 'API 地址' }), {
      target: { value: 'https://updated.example.com/api' },
    });
    fireEvent.change(
      dialogQueries.getByRole('textbox', { name: 'Detail 地址' }),
      {
        target: { value: 'https://updated.example.com/detail' },
      }
    );
    fireEvent.click(
      dialogQueries.getByRole('checkbox', { name: '🔞 成人内容源' })
    );
    fireEvent.click(
      dialogQueries.getByRole('checkbox', { name: '启用此视频源' })
    );
    fireEvent.click(dialogQueries.getByRole('button', { name: '保存修改' }));

    expect(
      dialogQueries.getByRole('button', { name: '保存中…' })
    ).toBeDisabled();
    expect(
      dialogQueries.getByRole('button', { name: '关闭编辑视频源' })
    ).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('edit-source-backdrop'));
    expect(screen.getByRole('dialog', { name: '编辑视频源' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/source',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'update',
          key: 'adult-source',
          name: 'Updated source',
          api: 'https://updated.example.com/api',
          detail: 'https://updated.example.com/detail',
          adult: false,
          disabled: true,
        }),
      })
    );

    await act(async () => {
      resolveUpdate(jsonResponse({ ok: true }));
    });

    await waitFor(() => expect(refreshAfterEdit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByText('未检测')).toHaveLength(1);
    expect(screen.getByText('正常 · 40 ms')).toBeInTheDocument();
  });

  test('keeps edited input and health state when saving fails', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ healthy: true, latencyMs: 25, message: '接口响应正常' })
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: '上游配置保存失败' }, false, 500)
      );
    render(
      <VideoSourceConfig
        config={createConfig()}
        refreshConfig={refreshConfig}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: '检测' })[0]);
    expect(await screen.findByText('正常 · 25 ms')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑 adult-source' }));
    const dialog = screen.getByRole('dialog', { name: '编辑视频源' });
    const nameInput = within(dialog).getByRole('textbox', { name: '名称' });
    fireEvent.change(nameInput, { target: { value: 'Unsaved source' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));

    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: '保存修改',
        })
      ).toBeEnabled()
    );
    expect(
      within(screen.getByRole('dialog')).getByRole('textbox', {
        name: '名称',
      })
    ).toHaveValue('Unsaved source');
    expect(screen.getByText('正常 · 25 ms')).toBeInTheDocument();
    expect(refreshConfig).not.toHaveBeenCalled();
  });

  test('closes the edit dialog with Escape, the close button, and the backdrop', () => {
    render(
      <VideoSourceConfig
        config={createConfig()}
        refreshConfig={refreshConfig}
      />
    );
    const openDialog = () =>
      fireEvent.click(
        screen.getByRole('button', { name: '编辑 adult-source' })
      );

    openDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openDialog();
    fireEvent.click(screen.getByRole('button', { name: '关闭编辑视频源' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openDialog();
    fireEvent.click(screen.getByTestId('edit-source-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
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
