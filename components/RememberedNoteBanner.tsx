import React, { useState } from 'react';
import { Info } from '@phosphor-icons/react';
import { RememberedNote, undoRememberedNote } from '../services/geminiService';

/**
 * 「AI 记住了…（撤销）」提示条 —— AI 顾问与阅读管家共用。
 *
 * 存在的理由：回合后抽取是**用户没要求过的后台写入**。它可能记错，所以必须
 * 当场可见、一键可撤；设置页另有完整历史（提示条会随刷新消失，历史不会）。
 * 画像字段与长期记忆都在这一条里展示，因为对用户来说它们是同一件事：
 * "AI 刚偷偷记住了什么"。
 */

const FIELD_LABELS: Record<string, string> = {
  readingLevel: '阅读水平',
  readingGoal: '阅读目标',
  preferredCategories: '偏好分类',
  dailyReadingTime: '每日阅读时间',
  nickname: '称呼',
};

const MEMORY_KIND_LABELS: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  constraint: '禁忌',
  goal: '目标',
  event: '有时限的事',
};

const formatValue = (v: any): string => {
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'number') return `${v} 分钟`;
  return String(v ?? '');
};

interface Props {
  note: RememberedNote;
  /** 撤销成功后调用（调用方清掉这条状态） */
  onDone: () => void;
}

export const RememberedNoteBanner: React.FC<Props> = ({ note, onDone }) => {
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUndo = async () => {
    setUndoing(true);
    setError(null);
    try {
      await undoRememberedNote(note);
      onDone();
    } catch (e: any) {
      setError(`撤销失败：${e?.message || '未知错误'}`);
    } finally {
      setUndoing(false);
    }
  };

  const items = [
    ...note.profileFields.map((f) => `${FIELD_LABELS[f.field] || f.field}：${formatValue(f.value)}`),
    ...note.memories.map((m) => `[${MEMORY_KIND_LABELS[m.kind] || m.kind}] ${m.content}`),
  ];
  if (items.length === 0) return null;

  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
      <Info size={14} className="mt-0.5 shrink-0 text-indigo-500" />
      <div className="min-w-0 flex-1 text-xs leading-relaxed text-indigo-900">
        <span className="font-medium">AI 记住了</span>
        <span className="text-indigo-700/70">（后台自动记的，你随时可以撤）</span>
        <ul className="mt-0.5 space-y-0.5">
          {items.map((t, i) => (
            <li key={i} className="text-indigo-800">{t}</li>
          ))}
        </ul>
        {error && <p className="mt-1 text-rose-600">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={handleUndo}
          disabled={undoing}
          className="rounded px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          {undoing ? '撤销中…' : '撤销'}
        </button>
        <button
          onClick={onDone}
          className="rounded px-1.5 py-0.5 text-xs text-indigo-400 hover:bg-indigo-100 hover:text-indigo-600"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default RememberedNoteBanner;
