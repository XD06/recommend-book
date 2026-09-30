import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Download,
  Upload,
  ArrowClockwise,
  Trash,
  FileJs,
  Warning,
  Info,
  UserCircle,
  FloppyDisk,
  Brain,
} from '@phosphor-icons/react';
import { Card, CardHeader, CardContent, CardFooter } from './Card';
import { Button } from './Button';
import { Book, BookStatus, ReadingLevel, UserProfile } from '../types';
import { analyzeUserProfileStream, fetchProfileWriteLog, undoProfileWrite, ProfileWriteLogItem, fetchMemories, rejectMemory, restoreMemory, MemoryItem } from '../services/geminiService';
import { fetchLibraryStats } from '../services/bookService';

interface DataManagementProps {
  onExport: () => void;
  onImport: (file: File) => void;
  onClearAll?: () => void;
  stats: {
    totalBooks: number;
    categoriesCount: number;
    lastUpdated: string;
  };
  onReorganize?: () => void;
  isReorganizing?: boolean;
  userProfile?: UserProfile | null;
  availableCategories?: string[];
  onSaveProfile?: (profile: UserProfile) => Promise<void> | void;
  /** 供"AI 分析阅读结构"构建请求载荷（只用它在读/已读完的名单，统计数字仍取后端） */
  books?: Book[];
  /** AI 分析已写回服务端后调用，让上层重新拉画像 */
  onRefreshProfile?: () => Promise<any> | void;
}

const LEVEL_OPTIONS: Array<{ value: ReadingLevel; label: string; hint: string }> = [
  { value: 'beginner', label: '入门', hint: '偏好易读、篇幅可控的书' },
  { value: 'intermediate', label: '进阶', hint: '能读专业入门与综述类' },
  { value: 'advanced', label: '高阶', hint: '能啃原著、论文与体系化专著' },
  { value: 'expert', label: '专家', hint: '需要前沿、硬核的内容' },
];

/** 画像字段的中文名，用于"这些信息从哪来"的逐字段来源展示 */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  readingLevel: '阅读水平',
  readingGoal: '阅读目标',
  preferredCategories: '偏好分类',
  dailyReadingTime: '每日阅读时间',
  nickname: '称呼',
};

/** 记忆类别的中文标签（与后端注入时用的标签保持一致） */
const MEMORY_KIND_LABELS: Record<string, string> = {
  fact: '事实',
  preference: '偏好',
  constraint: '禁忌',
  goal: '目标',
  event: '有时限的事',
};

/** 画像取值的展示形式（数组按顿号连、分钟带单位） */
const formatValue = (v: any): string => {
  if (Array.isArray(v)) return v.join('、');
  if (typeof v === 'number') return `${v} 分钟`;
  return String(v ?? '');
};

export const DataManagement: React.FC<DataManagementProps> = ({
  onExport,
  onImport,
  onClearAll,
  stats,
  onReorganize,
  isReorganizing = false,
  userProfile,
  availableCategories = [],
  onSaveProfile,
  books = [],
  onRefreshProfile,
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [level, setLevel] = useState<ReadingLevel>(userProfile?.readingLevel ?? 'beginner');
  const [goal, setGoal] = useState(userProfile?.readingGoal ?? '');
  const [minutes, setMinutes] = useState(userProfile?.dailyReadingTime ?? 30);
  const [preferred, setPreferred] = useState<string[]>(userProfile?.preferredCategories ?? []);
  const [savingProfile, setSavingProfile] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  /** 画像改动历史（可撤销）—— 追加式日志，包含"谁改的、依据什么、改之前是什么" */
  const [profileLog, setProfileLog] = useState<ProfileWriteLogItem[]>([]);
  const [undoingId, setUndoingId] = useState<number | null>(null);

  const loadProfileLog = React.useCallback(async () => {
    try {
      setProfileLog(await fetchProfileWriteLog(20));
    } catch {
      // 拉不到就不显示这一块，不打扰用户
    }
  }, []);

  useEffect(() => { void loadProfileLog(); }, [loadProfileLog, userProfile?.updatedAt]);

  const handleUndoWrite = async (logId: number) => {
    setUndoingId(logId);
    try {
      await undoProfileWrite(logId);
      await onRefreshProfile?.();
      await loadProfileLog();
    } finally {
      setUndoingId(null);
    }
  };

  // ---------------------------------------------------------------- 长期记忆
  /** AI 记下的事实/偏好/禁忌/约定。与画像是两回事，所以单独一块管理。 */
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [showRejected, setShowRejected] = useState(false);
  const [busyMemoryId, setBusyMemoryId] = useState<number | null>(null);

  const loadMemories = React.useCallback(async (withRejected = false) => {
    try {
      const active = await fetchMemories('active', 100);
      const rejected = withRejected ? await fetchMemories('rejected', 100) : [];
      setMemories([...active, ...rejected]);
    } catch {
      // 拉不到就不显示这一块
    }
  }, []);

  useEffect(() => { void loadMemories(showRejected); }, [loadMemories, showRejected]);

  const handleRejectMemory = async (id: number) => {
    setBusyMemoryId(id);
    try {
      await rejectMemory(id);
      await loadMemories(showRejected);
    } finally {
      setBusyMemoryId(null);
    }
  };

  const handleRestoreMemory = async (id: number) => {
    setBusyMemoryId(id);
    try {
      await restoreMemory(id);
      await loadMemories(showRejected);
    } finally {
      setBusyMemoryId(null);
    }
  };

  // 画像异步加载完成后填充表单，避免首帧显示默认值
  useEffect(() => {
    if (!userProfile) return;
    setLevel(userProfile.readingLevel);
    setGoal(userProfile.readingGoal ?? '');
    setMinutes(userProfile.dailyReadingTime ?? 30);
    setPreferred(userProfile.preferredCategories ?? []);
  }, [userProfile]);

  const togglePreferred = (cat: string) => {
    setPreferred(prev => (prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]));
  };

  const handleSaveProfile = async () => {
    if (!onSaveProfile) return;
    setSavingProfile(true);
    try {
      // 只发表单真正拥有的字段：PUT /api/profile 对 undefined 字段不写库，
      // 所以不必展开 userProfile 去"保留 aiAnalysis"。展开了反而会把
      // AI 通过 update_user_profile 刚写进去的字段按旧快照冲掉
      await onSaveProfile({
        readingLevel: level,
        readingGoal: goal.trim() || undefined,
        dailyReadingTime: minutes,
        preferredCategories: preferred,
      });
    } finally {
      setSavingProfile(false);
    }
  };

  /**
   * 让 AI 分析阅读结构，写回 user_profiles.ai_analysis。
   *
   * 这个能力此前是"两头都有、中间断的"：端点 `/api/ai/profile/stream` 与
   * 下方的展示位都在，但前端零调用、后端也不写回，于是真实数据里 ai_analysis
   * 恒为 NULL，注入给模型的画像永远少"盲区 / 建议方向"这两行——恰恰是最能
   * 改变推荐口吻的两行。
   *
   * 统计数字仍取后端 `fetchLibraryStats()`（统计口径只有一份实现），
   * books 只用来提供在读/已读完的名单。
   */
  const handleAnalyzeProfile = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const s = await fetchLibraryStats();
      await analyzeUserProfileStream({
        totalBooks: s.totals.total,
        readingCount: s.totals.reading,
        finishedCount: s.totals.finished,
        unreadCount: s.totals.unread,
        totalPagesRead: s.pages.read,
        categoryDistribution: s.byCategory.map(c => ({ category: c.name, count: c.total })),
        levelDistribution: s.levels,
        readingBooks: books
          .filter(b => b.status === BookStatus.READING)
          .map(b => ({
            title: b.title, author: b.author,
            progress: b.userData?.progressPercentage ?? 0,
            category: b.category, level: b.level,
          })),
        finishedBooks: books
          .filter(b => b.status === BookStatus.FINISHED)
          .map(b => ({ title: b.title, author: b.author, category: b.category, level: b.level })),
        currentProfile: {
          readingLevel: level,
          readingGoal: goal.trim() || undefined,
          preferredCategories: preferred,
        },
      }, {});
      // 后端已在 /profile/stream 里写回 ai_analysis，这里只需把新画像拉回来
      await onRefreshProfile?.();
    } catch (e: any) {
      setAnalyzeError(e?.message || '分析失败，请稍后重试');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onImport(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onImport(e.target.files[0]);
    }
  };

  return (
    <div className="space-y-6 pt-[var(--top-nav-h)] pb-[calc(var(--bottom-nav-h)_+_1rem)] md:pb-8 max-w-3xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      >
        <h1 className="text-2xl font-bold text-zinc-900">数据管理</h1>
        <p className="text-zinc-500 mt-1">备份、恢复和整理你的书库数据</p>
      </motion.div>

      {/* Stats Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader title="数据概览" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-zinc-50 rounded-xl">
              <div className="text-2xl font-bold text-zinc-900 font-mono">{stats.totalBooks}</div>
              <div className="text-xs text-zinc-500 mt-1">藏书总数</div>
            </div>
            <div className="text-center p-4 bg-zinc-50 rounded-xl">
              <div className="text-2xl font-bold text-zinc-900 font-mono">{stats.categoriesCount}</div>
              <div className="text-xs text-zinc-500 mt-1">分类数量</div>
            </div>
            <div className="text-center p-4 bg-zinc-50 rounded-xl">
              <div className="text-lg font-bold text-zinc-900">{stats.lastUpdated}</div>
              <div className="text-xs text-zinc-500 mt-1">最后更新</div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Reading Profile — AI 推荐的个性化输入 */}
      {onSaveProfile && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}
        >
          <Card>
            <CardHeader
              title="阅读画像"
              subtitle="AI 顾问每次推荐都会读取这份画像。你在这里保存过的字段属于你的期望，AI 只能沿用、不会覆盖（想改直接在这里改）"
              icon={<UserCircle className="w-5 h-5 text-accent-600" />}
            />
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                  阅读水平
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {LEVEL_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setLevel(opt.value)}
                      title={opt.hint}
                      className={[
                        'px-3 py-2 rounded-lg text-sm transition-colors border',
                        level === opt.value
                          ? 'bg-accent-50 border-accent-200 text-accent-700 font-medium'
                          : 'bg-zinc-50 border-transparent text-zinc-600 hover:bg-zinc-100',
                      ].join(' ')}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-400 mt-1.5">
                  {LEVEL_OPTIONS.find(o => o.value === level)?.hint}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">
                  阅读目标
                </label>
                <textarea
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  rows={2}
                  placeholder="例如：下半年把系统编程的基础补起来，兼顾可读性"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 bg-zinc-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-100 resize-y"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">
                  每日阅读时间：<span className="font-mono normal-case">{minutes}</span> 分钟
                </label>
                <input
                  type="range"
                  min={5}
                  max={180}
                  step={5}
                  value={minutes}
                  onChange={e => setMinutes(Number(e.target.value))}
                  className="w-full accent-accent-600"
                />
                <p className="text-xs text-zinc-400 mt-1">影响 AI 排出的书单体量与阅读路径预估</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                  偏好分类
                </label>
                {availableCategories.length === 0 ? (
                  <p className="text-sm text-zinc-400">书库还没有分类可选项</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableCategories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => togglePreferred(cat)}
                        className={[
                          'px-2.5 py-1 rounded-full text-xs transition-colors border',
                          preferred.includes(cat)
                            ? 'bg-accent-50 border-accent-200 text-accent-700'
                            : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:bg-zinc-100',
                        ].join(' ')}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {analyzeError && (
                <div className="flex items-start gap-2 p-3 bg-rose-50 rounded-lg border border-rose-100">
                  <Warning className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-700">{analyzeError}</p>
                </div>
              )}

              {/* 信息从哪来 —— 用户自己定的（AI 不会覆盖）与 AI 记录/推断的必须让人一眼分清 */}
              {userProfile?.fieldMeta && Object.keys(userProfile.fieldMeta).length > 0 && (
                <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1.5">
                  <p className="text-xs font-medium text-zinc-700">这些信息从哪来</p>
                  <ul className="space-y-1">
                    {Object.entries(userProfile.fieldMeta).map(([field, meta]) => (
                      <li key={field} className="text-xs text-zinc-600 leading-relaxed">
                        <span className="text-zinc-500">{PROFILE_FIELD_LABELS[field] || field}：</span>
                        {meta.source === 'user' ? (
                          <span className="text-emerald-700">
                            {meta.via === 'conversation' ? '你在对话中说的' : '你自己填写的'}
                            <span className="text-zinc-400">（AI 不会覆盖）</span>
                            {meta.evidence && <span className="text-zinc-400"> · 原话“{meta.evidence}”</span>}
                          </span>
                        ) : (
                          <span className="text-amber-700">
                            AI 记录的（可能是推测，可被修正）
                            {meta.evidence && <span className="text-zinc-400"> · 依据“{meta.evidence}”</span>}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    你自己填或亲口说过的，AI 只能沿用、不能改写；AI 记录的只填空白字段。
                  </p>
                </div>
              )}

              {/* 画像改动历史 —— 追加式日志，提供"事后可查 + 可撤销"。
                  这是"AI 自己记东西"能被接受的前提：错误的记忆必须能收回来。 */}
              {profileLog.length > 0 && (
                <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1.5">
                  <p className="text-xs font-medium text-zinc-700">画像改动历史</p>
                  <ul className="space-y-1.5">
                    {profileLog.map((log) => (
                      <li key={log.id} className="flex items-start gap-2 text-xs leading-relaxed">
                        <span className={[
                          'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                          log.source === 'user' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
                        ].join(' ')}>
                          {log.source === 'user' ? '你' : 'AI'}
                        </span>
                        <span className="min-w-0 flex-1 text-zinc-600">
                          <span className="text-zinc-500">{PROFILE_FIELD_LABELS[log.field] || log.field}</span>
                          {' '}
                          {log.prevValue !== null && log.prevValue !== undefined
                            ? <><span className="text-zinc-400 line-through">{formatValue(log.prevValue)}</span>{' → '}</>
                            : <span className="text-zinc-400">（原本没有）{'→ '}</span>}
                          <span className="font-medium text-zinc-800">{formatValue(log.nextValue)}</span>
                          {log.evidence && <span className="text-zinc-400"> · 依据“{log.evidence}”</span>}
                          <span className="text-zinc-300"> · {new Date(log.createdAt).toLocaleString()}</span>
                        </span>
                        {log.undoneAt ? (
                          <span className="shrink-0 text-[10px] text-zinc-400">已撤销</span>
                        ) : (
                          <button
                            onClick={() => handleUndoWrite(log.id)}
                            disabled={undoingId === log.id}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent-700 hover:bg-accent-50 disabled:opacity-50"
                          >
                            {undoingId === log.id ? '撤销中…' : '撤销'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {userProfile?.aiAnalysis && (
                <div className="flex items-start gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                  <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-zinc-600 space-y-1">
                    <p className="font-medium text-zinc-700">
                      AI 分析（自动生成，手改会被覆盖）
                      {userProfile.aiAnalysis.lastUpdated && (
                        <span className="text-zinc-400 font-normal">
                          {' '}· {new Date(userProfile.aiAnalysis.lastUpdated).toLocaleDateString()}
                        </span>
                      )}
                    </p>
                    <p>{userProfile.aiAnalysis.readingPattern}</p>
                    {userProfile.aiAnalysis.blindSpots.length > 0 && (
                      <p>盲区：{userProfile.aiAnalysis.blindSpots.join('、')}</p>
                    )}
                    <p>建议方向：{userProfile.aiAnalysis.recommendedFocus}</p>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={handleSaveProfile}
                  isLoading={savingProfile}
                  leftIcon={<FloppyDisk className="w-4 h-4" />}
                >
                  保存画像
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleAnalyzeProfile}
                  isLoading={analyzing}
                  leftIcon={<ArrowClockwise className="w-4 h-4" />}
                >
                  {analyzing ? '分析中…' : 'AI 分析我的阅读结构'}
                </Button>
              </div>
            </CardFooter>
          </Card>
        </motion.div>
      )}

      {/* AI 的记忆 —— 没有槽位的事实/偏好/禁忌/约定，与画像分开管理 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader
            title="AI 的记忆"
            subtitle="AI 在对话里记下的事实、偏好、禁忌与约定。删除是终态：它不会再出现在推荐里，也不会被自动记回来"
            icon={<Brain className="w-5 h-5 text-accent-600" />}
          />
          <CardContent className="space-y-3">
            {memories.length === 0 ? (
              <p className="text-sm text-zinc-400">
                还没有记下任何事。当你在对话里说到稳定的偏好或禁忌（例如"我不看成功学"），AI 会记下来并在这里列出。
              </p>
            ) : (
              <ul className="space-y-2">
                {memories.map((m) => (
                  <li key={m.id} className="flex items-start gap-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                    <span className={[
                      'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      m.status === 'rejected' ? 'bg-zinc-200 text-zinc-500'
                        : m.kind === 'constraint' ? 'bg-rose-50 text-rose-700'
                        : m.kind === 'preference' ? 'bg-indigo-50 text-indigo-700'
                        : 'bg-amber-50 text-amber-700',
                    ].join(' ')}>
                      {MEMORY_KIND_LABELS[m.kind] || m.kind}
                    </span>
                    <div className="min-w-0 flex-1 text-xs leading-relaxed">
                      <p className={m.status === 'rejected' ? 'text-zinc-400 line-through' : 'text-zinc-700'}>
                        {m.content}
                      </p>
                      <p className="text-zinc-400">
                        {m.source === 'user' ? '你说的' : 'AI 记录的'}
                        {m.evidence && ` · 依据“${m.evidence}”`}
                        {m.expiresAt && ` · ${m.expiresAt.slice(0, 10)} 到期`}
                        {` · ${new Date(m.createdAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    {m.status === 'rejected' ? (
                      <button
                        onClick={() => handleRestoreMemory(m.id)}
                        disabled={busyMemoryId === m.id}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
                      >
                        恢复
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRejectMemory(m.id)}
                        disabled={busyMemoryId === m.id}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {busyMemoryId === m.id ? '删除中…' : '删除'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setShowRejected((v) => !v)}
              className="text-[11px] text-zinc-400 hover:text-zinc-600"
            >
              {showRejected ? '隐藏已删除的' : '显示已删除的（可恢复）'}
            </button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Export Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader
            title="导出数据"
            subtitle="将书库数据备份到本地文件"
            icon={<Download className="w-5 h-5 text-accent-600" />}
          />
          <CardContent>
            <div className="flex items-start gap-3 p-3 bg-accent-50 rounded-lg border border-accent-100">
              <Info className="w-4 h-4 text-accent-600 shrink-0 mt-0.5" />
              <p className="text-sm text-accent-800">
                导出的文件包含所有书籍信息、分类元数据和阅读进度。建议定期备份。
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={onExport} leftIcon={<Download className="w-4 h-4" />}>
              导出 JSON
            </Button>
          </CardFooter>
        </Card>
      </motion.div>

      {/* Import Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader
            title="导入数据"
            subtitle="从备份文件恢复书库数据"
            icon={<Upload className="w-5 h-5 text-accent-600" />}
          />
          <CardContent>
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={[
                'relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200',
                dragActive
                  ? 'border-accent-500 bg-accent-50'
                  : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50',
              ].join(' ')}
            >
              <input
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="w-12 h-12 rounded-xl bg-white border border-zinc-200 flex items-center justify-center mx-auto mb-3 shadow-sm">
                <FileJs className="w-6 h-6 text-zinc-400" />
              </div>
              <p className="text-sm font-medium text-zinc-700 mb-1">
                拖拽文件到此处，或点击选择
              </p>
              <p className="text-xs text-zinc-400">支持 .json 格式的 DeepRead 备份文件</p>
            </div>
            <div className="flex items-start gap-3 p-3 bg-warning-50 rounded-lg border border-warning-100 mt-4">
              <Warning className="w-4 h-4 text-warning-600 shrink-0 mt-0.5" />
              <p className="text-sm text-warning-800">
                导入操作将覆盖当前所有数据，请确保已备份重要信息。
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* AI Organization */}
      {onReorganize && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
        >
          <Card>
            <CardHeader
              title="AI 智能整理"
              subtitle="使用 AI 重新分类和整理书库"
              icon={<ArrowClockwise className="w-5 h-5 text-accent-600" />}
            />
            <CardContent>
              <div className="flex items-start gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <p className="text-sm text-zinc-600">
                  AI 将分析所有书籍的内容和主题，自动分配到最合适的分类中。此操作会修改现有分类结构。
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                variant="secondary"
                onClick={onReorganize}
                isLoading={isReorganizing}
                leftIcon={<ArrowClockwise className="w-4 h-4" />}
              >
                开始整理
              </Button>
            </CardFooter>
          </Card>
        </motion.div>
      )}

      {/* Danger Zone */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader
            title="危险区域"
            subtitle="不可逆操作，请谨慎使用"
            icon={<Trash className="w-5 h-5 text-danger-500" />}
          />
          <CardContent>
            <div className="flex items-start gap-3 p-3 bg-danger-50 rounded-lg border border-danger-100">
              <Warning className="w-4 h-4 text-danger-600 shrink-0 mt-0.5" />
              <p className="text-sm text-danger-800">
                清除所有数据将无法恢复。建议先导出备份。
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant="danger"
              onClick={onClearAll}
              leftIcon={<Trash className="w-4 h-4" />}
            >
              清除所有数据
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
};
