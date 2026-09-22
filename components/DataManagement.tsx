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
} from '@phosphor-icons/react';
import { Card, CardHeader, CardContent, CardFooter } from './Card';
import { Button } from './Button';
import { ReadingLevel, UserProfile } from '../types';

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
}

const LEVEL_OPTIONS: Array<{ value: ReadingLevel; label: string; hint: string }> = [
  { value: 'beginner', label: '入门', hint: '偏好易读、篇幅可控的书' },
  { value: 'intermediate', label: '进阶', hint: '能读专业入门与综述类' },
  { value: 'advanced', label: '高阶', hint: '能啃原著、论文与体系化专著' },
  { value: 'expert', label: '专家', hint: '需要前沿、硬核的内容' },
];

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
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [level, setLevel] = useState<ReadingLevel>(userProfile?.readingLevel ?? 'beginner');
  const [goal, setGoal] = useState(userProfile?.readingGoal ?? '');
  const [minutes, setMinutes] = useState(userProfile?.dailyReadingTime ?? 30);
  const [preferred, setPreferred] = useState<string[]>(userProfile?.preferredCategories ?? []);
  const [savingProfile, setSavingProfile] = useState(false);

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
              subtitle="AI 顾问每次推荐都会读取这份画像；不填写则推荐以无个性化模式运行"
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

              {userProfile?.aiAnalysis && (
                <div className="flex items-start gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                  <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-zinc-600 space-y-1">
                    <p className="font-medium text-zinc-700">AI 分析（自动生成，手改会被覆盖）</p>
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
              <Button
                onClick={handleSaveProfile}
                isLoading={savingProfile}
                leftIcon={<FloppyDisk className="w-4 h-4" />}
              >
                保存画像
              </Button>
            </CardFooter>
          </Card>
        </motion.div>
      )}

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
