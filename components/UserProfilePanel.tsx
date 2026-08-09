import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Book, BookStatus, BookLevel, UserProfile, ReadingLevel } from '../types';
import { Card, CardHeader } from './Card';
import { Button } from './Button';
import { analyzeUserProfileStream, ProfileAnalysisResult } from '../services/geminiService';
import { AIActivityPanel, useAIActivity } from './AIActivityPanel';
import {
  Sparkle, Robot, Target, Eye, Compass, PencilSimple, FloppyDisk, ArrowClockwise,
} from '@phosphor-icons/react';

interface UserProfilePanelProps {
  profile: UserProfile;
  onUpdate: (profile: UserProfile) => void;
  books: Book[];
}

const levelOptions: { value: ReadingLevel; label: string; desc: string }[] = [
  { value: 'beginner', label: '初学者', desc: '刚开始建立阅读习惯' },
  { value: 'intermediate', label: '中级读者', desc: '有基础，想深入' },
  { value: 'advanced', label: '高级读者', desc: '广泛阅读，深度理解' },
  { value: 'expert', label: '专家级', desc: '追求极致深度和广度' },
];

export const UserProfilePanel: React.FC<UserProfilePanelProps> = ({ profile, onUpdate, books }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const ai = useAIActivity();
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [editLevel, setEditLevel] = useState<ReadingLevel>(profile.readingLevel);
  const [editGoal, setEditGoal] = useState(profile.readingGoal || '');
  const [editCategories, setEditCategories] = useState(profile.preferredCategories.join('、'));
  const [editTime, setEditTime] = useState(profile.dailyReadingTime?.toString() || '');
  const [editNickname, setEditNickname] = useState(profile.nickname || '');

  const handleSave = () => {
    onUpdate({
      ...profile,
      nickname: editNickname.trim() || undefined,
      readingLevel: editLevel,
      readingGoal: editGoal.trim() || undefined,
      preferredCategories: editCategories.split(/[、,，\s]+/).filter(Boolean),
      dailyReadingTime: editTime ? parseInt(editTime) : undefined,
    });
    setIsEditing(false);
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    ai.reset();
    ai.startTimer();
    setAnalyzeError(null);
    try {
      const reading = books.filter(b => b.status === BookStatus.READING);
      const finished = books.filter(b => b.status === BookStatus.FINISHED);
      const totalPagesRead = books.reduce((sum, b) => {
        if (!b.userData) return sum;
        return sum + (b.status === BookStatus.FINISHED ? b.userData.totalPages : b.userData.currentPage);
      }, 0);

      // 分类分布
      const catMap: Record<string, number> = {};
      books.forEach(b => { catMap[b.category] = (catMap[b.category] || 0) + 1; });
      const categoryDistribution = Object.entries(catMap)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);

      // 难度分布
      const levelDistribution = {
        Basic: books.filter(b => b.level === BookLevel.BASIC).length,
        Advanced: books.filter(b => b.level === BookLevel.ADVANCED).length,
        Expert: books.filter(b => b.level === BookLevel.EXPERT).length,
      };

      const result: ProfileAnalysisResult = await analyzeUserProfileStream(
        {
          totalBooks: books.length,
          readingCount: reading.length,
          finishedCount: finished.length,
          unreadCount: books.filter(b => b.status === BookStatus.UNREAD).length,
          totalPagesRead,
          categoryDistribution,
          levelDistribution,
          readingBooks: reading.map(b => ({
            title: b.title, author: b.author,
            progress: b.userData?.progressPercentage || 0,
            category: b.category, level: b.level,
          })),
          finishedBooks: finished.map(b => ({
            title: b.title, author: b.author,
            category: b.category, level: b.level,
          })),
          currentProfile: {
            readingLevel: profile.readingLevel,
            readingGoal: profile.readingGoal,
            preferredCategories: profile.preferredCategories,
          },
          library: books,
        },
        {
          onChunk: (chunk) => ai.handleChunk(chunk),
          onPhase: (phase) => ai.handlePhase(phase),
          onToolCall: (toolName, label, round) => ai.handleToolCall(toolName, label, round),
          onReasoning: ai.handleReasoning,
        },
      );

      onUpdate({
        ...profile,
        aiAnalysis: {
          inferredLevel: result.inferredLevel,
          readingPattern: result.readingPattern,
          blindSpots: result.blindSpots,
          recommendedFocus: result.recommendedFocus,
          lastUpdated: new Date().toISOString(),
        },
      });
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : '分析失败');
    } finally {
      setAnalyzing(false);
      ai.stopTimer();
    }
  };

  const levelLabel = levelOptions.find(l => l.value === profile.readingLevel)?.label || profile.readingLevel;
  const aiLevelLabel = levelOptions.find(l => l.value === profile.aiAnalysis?.inferredLevel)?.label;

  return (
    <div className="space-y-6 pt-20 pb-28 md:pb-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900">用户画像</h1>
          <p className="text-sm text-zinc-500 mt-1">AI 会记住你的水平和目标，提供更个性化的推荐</p>
        </div>
        {!isEditing ? (
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="self-start sm:self-auto">
            <PencilSimple size={14} /> 编辑
          </Button>
        ) : (
          <div className="flex gap-2 self-start sm:self-auto">
            <Button size="sm" onClick={handleSave}>
              <FloppyDisk size={14} /> 保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
              取消
            </Button>
          </div>
        )}
      </motion.div>

      {/* 基础信息 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card>
          <CardHeader title="基础信息" icon={<Target className="w-5 h-5 text-accent-600" weight="fill" />} />
          
          {!isEditing ? (
            <div className="grid grid-cols-1 gap-4">
              <div className="grid grid-cols-2 gap-4">
                <InfoRow label="昵称" value={profile.nickname || '未设置'} />
                <InfoRow label="阅读水平" value={levelLabel} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <InfoRow label="阅读目标" value={profile.readingGoal || '未设置'} />
                <InfoRow label="每日阅读时间" value={profile.dailyReadingTime ? `${profile.dailyReadingTime} 分钟` : '未设置'} />
              </div>
              <InfoRow label="偏好领域" value={profile.preferredCategories.length > 0 ? profile.preferredCategories.join('、') : '未设置'} />
            </div>
          ) : (
            <div className="space-y-5">
              {/* 昵称 */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">昵称</label>
                <input
                  type="text"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  placeholder="你的昵称"
                  className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500 focus:bg-white transition-all"
                />
              </div>

              {/* 阅读水平 */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-2">阅读水平</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {levelOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setEditLevel(opt.value)}
                      className={`p-2.5 sm:p-3 rounded-xl text-left border transition-all ${
                        editLevel === opt.value
                          ? 'border-accent-500 bg-accent-50 ring-2 ring-accent-100'
                          : 'border-zinc-200 bg-white hover:border-zinc-300'
                      }`}
                    >
                      <p className="text-sm font-medium text-zinc-900">{opt.label}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5 leading-tight">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* 阅读目标 */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">阅读目标</label>
                <input
                  type="text"
                  value={editGoal}
                  onChange={(e) => setEditGoal(e.target.value)}
                  placeholder="例如：成为全栈工程师 / 读完所有的经典文学"
                  className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500 focus:bg-white transition-all"
                />
              </div>

              {/* 偏好分类 */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">偏好领域（用顿号分隔）</label>
                <input
                  type="text"
                  value={editCategories}
                  onChange={(e) => setEditCategories(e.target.value)}
                  placeholder="例如：计算机科学、心理学、历史"
                  className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500 focus:bg-white transition-all"
                />
              </div>

              {/* 每日阅读时间 */}
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1.5">每日阅读时间（分钟）</label>
                <input
                  type="number"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  placeholder="例如：30"
                  className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500 focus:bg-white transition-all"
                />
              </div>
            </div>
          )}
        </Card>
      </motion.div>

      {/* AI 分析 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Card>
          <CardHeader
            title="AI 画像分析"
            subtitle="AI 根据你的阅读数据自动分析"
            icon={<Sparkle className="w-5 h-5 text-accent-600" weight="fill" />}
            action={
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="text-sm font-medium text-accent-600 hover:text-accent-700 disabled:opacity-50 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-50 hover:bg-accent-100 transition-colors"
              >
                {analyzing ? '分析中...' : profile.aiAnalysis ? '重新分析' : '开始分析'}
              </button>
            }
          />

          {/* AI 活动面板 */}
          {analyzing && (
            <div className="py-4">
              <AIActivityPanel
                phase={ai.phase}
                toolCalls={ai.toolCalls}
                reasoningText={ai.reasoningText}
                elapsedTime={ai.elapsedTime}
                receivedChars={ai.receivedChars}
                onCancel={() => { ai.reset(); setAnalyzing(false); }}
                thinkingLabel="正在分析阅读数据"
                generatingLabel="正在生成画像报告"
              />
            </div>
          )}

          {/* Error state */}
          {analyzeError && !analyzing && (
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-3">
                <Sparkle size={24} className="text-rose-400" weight="fill" />
              </div>
              <p className="text-sm font-medium text-zinc-700 mb-1">分析失败</p>
              <p className="text-xs text-zinc-400 mb-4">{analyzeError}</p>
              <Button size="sm" variant="outline" onClick={handleAnalyze} leftIcon={<ArrowClockwise size={14} />}>
                重试
              </Button>
            </div>
          )}

          {/* 分析结果 */}
          {profile.aiAnalysis && !analyzing && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-zinc-900 text-white flex items-center justify-center shrink-0">
                  <Robot size={16} weight="fill" />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1.5">阅读模式</h4>
                  <p className="text-sm text-zinc-700 leading-relaxed">{profile.aiAnalysis.readingPattern}</p>
                  {aiLevelLabel && (
                    <p className="text-xs text-zinc-400 mt-1.5">
                      AI 推断水平：<span className="font-medium text-accent-600">{aiLevelLabel}</span>
                    </p>
                  )}
                </div>
              </div>

              {profile.aiAnalysis.blindSpots.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                  <h4 className="flex items-center gap-2 text-xs font-semibold text-rose-700 uppercase tracking-wide mb-2">
                    <Eye size={14} weight="fill" />
                    知识盲区
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {profile.aiAnalysis.blindSpots.map((s, i) => (
                      <span key={i} className="px-2.5 py-1 rounded-lg text-xs bg-white border border-rose-200 text-rose-700">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profile.aiAnalysis.recommendedFocus && (
                <div className="flex gap-3 rounded-xl border border-accent-200 bg-accent-50/50 p-4">
                  <Compass size={16} className="text-accent-600 shrink-0 mt-0.5" weight="fill" />
                  <div>
                    <h4 className="text-xs font-semibold text-accent-700 uppercase tracking-wide mb-1">建议关注</h4>
                    <p className="text-sm text-zinc-700 leading-relaxed">{profile.aiAnalysis.recommendedFocus}</p>
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-400 text-right">
                上次更新：{new Date(profile.aiAnalysis.lastUpdated).toLocaleString()}
              </p>
            </div>
          )}

          {/* Empty */}
          {!profile.aiAnalysis && !analyzing && !analyzeError && (
            <div className="text-center py-6">
              <p className="text-sm text-zinc-400">点击「开始分析」让 AI 根据你的阅读历史生成画像</p>
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-xs font-medium text-zinc-400 mb-1">{label}</p>
    <p className="text-sm text-zinc-700">{value}</p>
  </div>
);
