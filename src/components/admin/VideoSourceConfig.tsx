'use client';

import {
  closestCenter,
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import Swal from 'sweetalert2';

import type { AdminConfig } from '@/lib/admin.types';
import type { AdminSource } from '@/lib/source.types';

export interface VideoSourceConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

interface ImportItem {
  key: string;
  reason: string;
}

interface ImportSummary {
  added: number;
  skipped: number;
  failed: number;
  skippedItems: ImportItem[];
  failedItems: ImportItem[];
}

type CheckState =
  | { state: 'checking' }
  | { state: 'healthy'; latencyMs: number; message: string }
  | { state: 'unhealthy'; latencyMs?: number; message: string };

const emptySource = (): AdminSource => ({
  name: '',
  key: '',
  api: '',
  detail: '',
  adult: false,
  disabled: false,
  from: 'custom',
});

const showError = (message: string) =>
  Swal.fire({ icon: 'error', title: '错误', text: message });

export default function VideoSourceConfig({
  config,
  refreshConfig,
}: VideoSourceConfigProps) {
  const [sources, setSources] = useState<AdminSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showSubscriptionForm, setShowSubscriptionForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newSource, setNewSource] = useState<AdminSource>(emptySource);
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(
    null
  );
  const [checkStates, setCheckStates] = useState<Record<string, CheckState>>(
    {}
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  useEffect(() => {
    if (config?.SourceConfig) {
      setSources(config.SourceConfig);
      setOrderChanged(false);
      setCheckStates({});
    }
  }, [config]);

  const callSourceApi = async (body: Record<string, unknown>) => {
    try {
      const response = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || `操作失败: ${response.status}`
        );
      }
      await refreshConfig();
    } catch (error) {
      showError(error instanceof Error ? error.message : '操作失败');
      throw error;
    }
  };

  const toggleAddForm = () => {
    setShowAddForm((visible) => !visible);
    setShowSubscriptionForm(false);
  };

  const toggleSubscriptionForm = () => {
    setShowSubscriptionForm((visible) => !visible);
    setShowAddForm(false);
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    callSourceApi({
      action: 'add',
      key: newSource.key,
      name: newSource.name,
      api: newSource.api,
      detail: newSource.detail,
      adult: newSource.adult,
    })
      .then(() => {
        setNewSource(emptySource());
        setShowAddForm(false);
      })
      .catch(() => undefined);
  };

  const handleImportSubscription = async () => {
    if (!subscriptionUrl.trim() || importing) return;
    setImporting(true);
    setImportSummary(null);
    try {
      const response = await fetch('/api/admin/source/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: subscriptionUrl.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<
        ImportSummary & { error: string }
      >;
      if (!response.ok) {
        throw new Error(data.error || `订阅导入失败: ${response.status}`);
      }
      setImportSummary({
        added: data.added || 0,
        skipped: data.skipped || 0,
        failed: data.failed || 0,
        skippedItems: data.skippedItems || [],
        failedItems: data.failedItems || [],
      });
      await refreshConfig();
    } catch (error) {
      showError(error instanceof Error ? error.message : '订阅导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleCheck = async (source: AdminSource) => {
    setCheckStates((current) => ({
      ...current,
      [source.key]: { state: 'checking' },
    }));
    try {
      const response = await fetch('/api/admin/source/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: source.key }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        healthy?: boolean;
        latencyMs?: number;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || `检测失败: ${response.status}`);
      }
      setCheckStates((current) => ({
        ...current,
        [source.key]: data.healthy
          ? {
              state: 'healthy',
              latencyMs: data.latencyMs || 0,
              message: data.message || '接口响应正常',
            }
          : {
              state: 'unhealthy',
              latencyMs: data.latencyMs,
              message: data.message || '接口响应异常',
            },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '检测失败';
      setCheckStates((current) => ({
        ...current,
        [source.key]: { state: 'unhealthy', message },
      }));
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((source) => source.key === key);
    if (!target) return;
    callSourceApi({
      action: target.disabled ? 'enable' : 'disable',
      key,
    }).catch(() => undefined);
  };

  const handleDelete = (key: string) => {
    callSourceApi({ action: 'delete', key }).catch(() => undefined);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((source) => source.key === active.id);
    const newIndex = sources.findIndex((source) => source.key === over.id);
    setSources((current) => arrayMove(current, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = sources.map((source) => source.key);
    callSourceApi({ action: 'sort', order })
      .then(() => setOrderChanged(false))
      .catch(() => undefined);
  };

  const checkLabel = (source: AdminSource) => {
    const status = checkStates[source.key];
    if (!status) return '未检测';
    if (status.state === 'checking') return '检测中';
    if (status.state === 'healthy') return `正常 · ${status.latencyMs} ms`;
    return `异常 · ${status.message}`;
  };

  const DraggableRow = ({ source }: { source: AdminSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: source.key });
    const checkState = checkStates[source.key];
    const checking = checkState?.state === 'checking';
    const retrying = checkState?.state === 'unhealthy';

    return (
      <tr
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
        }}
        className='select-none transition-colors hover:bg-gray-50 dark:hover:bg-gray-800'
      >
        <td
          className='cursor-grab px-2 py-4 text-gray-400'
          style={{ touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </td>
        <td className='whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
          {source.name}
        </td>
        <td className='whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'>
          {source.key}
        </td>
        <td
          className='max-w-[12rem] truncate whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'
          title={source.api}
        >
          {source.api}
        </td>
        <td
          className='max-w-[8rem] truncate whitespace-nowrap px-6 py-4 text-sm text-gray-900 dark:text-gray-100'
          title={source.detail || '-'}
        >
          {source.detail || '-'}
        </td>
        <td className='whitespace-nowrap px-6 py-4 text-center text-sm'>
          {source.adult ? <span title='成人内容源'>🔞</span> : '—'}
        </td>
        <td className='whitespace-nowrap px-6 py-4'>
          <span
            className={`rounded-full px-2 py-1 text-xs ${
              !source.disabled
                ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
            }`}
          >
            {!source.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='whitespace-nowrap px-6 py-4 text-sm text-gray-600 dark:text-gray-300'>
          {checkLabel(source)}
        </td>
        <td className='space-x-2 whitespace-nowrap px-6 py-4 text-right text-sm font-medium'>
          <button
            onClick={() => handleCheck(source)}
            disabled={checking}
            className='inline-flex items-center rounded-full bg-blue-100 px-3 py-1.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60'
          >
            {checking ? '检测中…' : retrying ? '重新检测' : '检测'}
          </button>
          <button
            onClick={() => handleToggleEnable(source.key)}
            className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              !source.disabled
                ? 'bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-900/60'
                : 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60'
            }`}
          >
            {!source.disabled ? '禁用' : '启用'}
          </button>
          {source.from !== 'config' && (
            <button
              onClick={() => handleDelete(source.key)}
              className='inline-flex items-center rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-800 transition-colors hover:bg-gray-200 dark:bg-gray-700/40 dark:text-gray-200 dark:hover:bg-gray-700/60'
            >
              删除
            </button>
          )}
        </td>
      </tr>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          视频源列表
        </h4>
        <div className='flex flex-wrap gap-2'>
          <button
            onClick={toggleAddForm}
            className='rounded-lg bg-green-600 px-3 py-1 text-sm text-white transition-colors hover:bg-green-700'
          >
            添加视频源
          </button>
          <button
            onClick={toggleSubscriptionForm}
            className='rounded-lg bg-blue-600 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-700'
          >
            添加订阅链接
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className='space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <input
              type='text'
              placeholder='名称'
              value={newSource.name}
              onChange={(event) =>
                setNewSource((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newSource.key}
              onChange={(event) =>
                setNewSource((current) => ({
                  ...current,
                  key: event.target.value,
                }))
              }
              className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(event) =>
                setNewSource((current) => ({
                  ...current,
                  api: event.target.value,
                }))
              }
              className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Detail 地址（选填）'
              value={newSource.detail}
              onChange={(event) =>
                setNewSource((current) => ({
                  ...current,
                  detail: event.target.value,
                }))
              }
              className='rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
          </div>
          <label className='flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
            <input
              type='checkbox'
              checked={newSource.adult}
              onChange={(event) =>
                setNewSource((current) => ({
                  ...current,
                  adult: event.target.checked,
                }))
              }
            />
            🔞 成人内容源
          </label>
          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={!newSource.name || !newSource.key || !newSource.api}
              className='w-full rounded-lg bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700 disabled:bg-gray-400 sm:w-auto'
            >
              添加
            </button>
          </div>
        </div>
      )}

      {showSubscriptionForm && (
        <div className='space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'>
          <div className='flex flex-col gap-3 sm:flex-row'>
            <input
              type='url'
              placeholder='订阅链接'
              value={subscriptionUrl}
              onChange={(event) => setSubscriptionUrl(event.target.value)}
              className='min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            />
            <button
              onClick={handleImportSubscription}
              disabled={!subscriptionUrl.trim() || importing}
              className='rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400'
            >
              {importing ? '导入中…' : '解析并导入'}
            </button>
          </div>
          {importSummary && (
            <div className='space-y-2 text-sm text-gray-700 dark:text-gray-300'>
              <p>
                新增 {importSummary.added}，跳过 {importSummary.skipped}，失败{' '}
                {importSummary.failed}
              </p>
              {[
                ...importSummary.skippedItems,
                ...importSummary.failedItems,
              ].map((item, index) => (
                <p key={`${item.key}-${index}`} className='text-xs'>
                  {item.key}：{item.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className='max-h-[28rem] overflow-x-auto overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700'>
        <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
          <thead className='bg-gray-50 dark:bg-gray-900'>
            <tr>
              <th className='w-8' />
              {[
                '名称',
                'Key',
                'API 地址',
                'Detail 地址',
                '🔞',
                '状态',
                '检测状态',
              ].map((heading) => (
                <th
                  key={heading}
                  className='px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'
                >
                  {heading}
                </th>
              ))}
              <th className='px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400'>
                操作
              </th>
            </tr>
          </thead>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            autoScroll={false}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={sources.map((source) => source.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {sources.map((source) => (
                  <DraggableRow key={source.key} source={source} />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>

      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            className='rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700'
          >
            保存排序
          </button>
        </div>
      )}
    </div>
  );
}
