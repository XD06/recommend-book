import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, BookStatus, BookLevel, getBookCoverUrl, hasBookCover } from '../types';
import { Button } from './Button';
import { Card } from './Card';
import { Badge } from './Badge';
import { DifficultyBadge, DifficultyScale } from './DifficultyBadge';
import { generateInsightStream } from '../services/geminiService';
import { AIActivityPanel, useAIActivity } from './AIActivityPanel';
import { useToast } from './Toast';
import {
  X,
  Play,
  BookOpen,
  Lightbulb,
  Target,
  CheckCircle,
  PencilSimple,
  FloppyDisk,
  Star,
  CaretRight,
  ChartLine,
  Calendar,
  Building,
  Hash,
  Users,
  TrendUp,
  Brain,
  StopCircle,
} from '@phosphor-icons/react';

interface BookDetailProps {
  book: Book;
  books: Book[];
  onClose: () => void;
  onUpdate: (updatedBook: Book) => void;
}

const levelText: Record<BookLevel, string> = {
  [BookLevel.BASIC]: '入门',
  [BookLevel.ADVANCED]: '进阶',
  [BookLevel.EXPERT]: '专家',
};

const levelColors: Record<BookLevel, string> = {
  [BookLevel.BASIC]: 'bg-success-50 text-success-700 border-success-200',
  [BookLevel.ADVANCED]: 'bg-accent-50 text-accent-700 border-accent-200',
  [BookLevel.EXPERT]: 'bg-danger-50 text-danger-700 border-danger-200',
};

export const BookDetail: React.FC<BookDetailProps> = ({ book, books, onClose, onUpdate }) => {
  const { showSuccess, showError } = useToast();
  const [isActivating, setIsActivating] = useState(false);
  const [activeTab, setActiveTab] = useState<'insight' | 'progress' | 'douban'>('insight');
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(book.title);
  const [editAuthor, setEditAuthor] = useState(book.author);
  const [editPublisher, setEditPublisher] = useState(book.publisher || '');
  const [editCategory, setEditCategory] = useState(book.category);
  const [editSubcategory, setEditSubcategory] = useState(book.subcategory);
  const [editLevel, setEditLevel] = useState<BookLevel>(book.level);
  // 自动从豆瓣数据填充页数
  const [totalPagesInput, setTotalPagesInput] = useState(
    book.userData?.totalPages?.toString() || 
    book.doubanData?.pages?.toString() || 
    ''
  );
  const [currentPageInput, setCurrentPageInput] = useState(book.userData?.currentPage?.toString() || '');
  const [percentageInput, setPercentageInput] = useState(book.userData?.progressPercentage?.toString() || '');
  // AI 解读生成中状态
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

  // 流式 AI 状态
  const ai = useAIActivity();
  const abortRef = useRef<AbortController | null>(null);

  const isUnread = book.status === BookStatus.UNREAD;
  const coverColor = book.coverColor || generateColor(book.title);
  
  // 豆瓣数据
  const doubanData = book.doubanData;
  
  const handleSaveEdit = () => {
    onUpdate({
      ...book,
      title: editTitle,
      author: editAuthor,
      publisher: editPublisher,
      category: editCategory,
      subcategory: editSubcategory,
      level: editLevel,
    });
    setIsEditing(false);
  };

  const handleStartReading = async () => {
    setIsActivating(true);
    setIsGeneratingInsight(true);
    ai.reset();
    ai.startTimer();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 先保存阅读状态，让用户可以立即开始阅读
      onUpdate({
        ...book,
        status: BookStatus.READING,
        userData: {
          totalPages: parseInt(totalPagesInput) || doubanData?.pages || 300,
          currentPage: 0,
          progressPercentage: 0,
          startDate: new Date().toISOString(),
        },
      });
      
      // 传入完整的豆瓣数据以获得更精准的 AI 解读
      const doubanDataForAI = doubanData ? {
        rating: doubanData.rating_score,
        ratingCount: doubanData.rating_count,
        summary: doubanData.summary,
        publisher: doubanData.publisher,
        pubdate: doubanData.publish_year || doubanData.pubdate,
      } : undefined;
      
      const insight = await generateInsightStream(
        {
          title: book.title,
          author: book.author,
          level: book.level,
          category: book.category,
          subcategory: book.subcategory,
          totalPages: parseInt(totalPagesInput) || doubanData?.pages || 300,
          doubanData: doubanDataForAI,
          library: books,
        },
        {
          onPhase: (phase) => ai.handlePhase(phase),
          onToolCall: (toolName, label, round) => ai.handleToolCall(toolName, label, round),
          onChunk: (chunk) => ai.handleChunk(chunk),
          onReasoning: ai.handleReasoning,
        },
        controller.signal,
      );
      
      // 更新 AI 解读
      onUpdate({
        ...book,
        status: BookStatus.READING,
        aiInsight: insight,
        userData: {
          totalPages: parseInt(totalPagesInput) || doubanData?.pages || 300,
          currentPage: 0,
          progressPercentage: 0,
          startDate: new Date().toISOString(),
        },
      });
      
      showSuccess('AI 解读生成成功');
      // 自动切换到 AI 解读 Tab
      setActiveTab('insight');
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // 用户取消，不显示错误
      } else {
        console.error('AI 解读生成失败:', error);
        showError('AI 解读生成失败，但已保存阅读进度');
      }
    } finally {
      setIsActivating(false);
      setIsGeneratingInsight(false);
      ai.stopTimer();
      abortRef.current = null;
    }
  };

  const handleStopInsight = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsActivating(false);
    setIsGeneratingInsight(false);
    ai.reset();
  };

  const updateProgress = (type: 'page' | 'percent') => {
    if (!book.userData) return;
    let newCurrent = book.userData.currentPage;
    let newPercent = book.userData.progressPercentage;
    const total = book.userData.totalPages;
    if (type === 'page') {
      newCurrent = Math.min(parseInt(currentPageInput) || 0, total);
      newPercent = (newCurrent / total) * 100;
    } else {
      newPercent = Math.min(parseFloat(percentageInput) || 0, 100);
      newCurrent = Math.round((newPercent / 100) * total);
    }
    const isFinished = newPercent >= 100;
    onUpdate({
      ...book,
      status: isFinished ? BookStatus.FINISHED : BookStatus.READING,
      userData: {
        ...book.userData,
        currentPage: newCurrent,
        progressPercentage: newPercent,
        completionDate: isFinished ? new Date().toISOString() : undefined,
      },
    });
    setCurrentPageInput(newCurrent.toString());
    setPercentageInput(newPercent.toFixed(1));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-zinc-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        className="bg-white w-full max-w-2xl rounded-t-2xl md:rounded-2xl shadow-modal overflow-hidden flex flex-col max-h-[90vh] md:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 md:p-6 border-b border-zinc-100">
          <div className="flex justify-between items-start gap-4">
            {/* Book Cover - 优先使用豆瓣封面，放大尺寸 */}
            {hasBookCover(book) ? (
              <div className="w-20 h-28 md:w-24 md:h-36 rounded-lg shadow-md flex-shrink-0 overflow-hidden bg-zinc-100">
                <img
                  src={getBookCoverUrl(book)}
                  alt={book.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    // 封面加载失败时显示色块
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      parent.style.backgroundColor = coverColor;
                      parent.innerHTML = `<span class="text-white font-semibold text-sm text-center line-clamp-3 p-3">${book.title}</span>`;
                    }
                  }}
                />
              </div>
            ) : (
              <div
                className="w-20 h-28 md:w-24 md:h-36 rounded-lg shadow-md flex-shrink-0 flex items-center justify-center p-3"
                style={{ backgroundColor: coverColor }}
              >
                <span className="text-white font-semibold text-sm text-center line-clamp-3">
                  {book.title}
                </span>
              </div>
            )}

            <div className="flex-1 min-w-0">
              {isEditing ? (
                <div className="space-y-2.5 animate-fade-in">
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 text-base font-semibold bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                    placeholder="书名"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editAuthor}
                      onChange={(e) => setEditAuthor(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                      placeholder="作者"
                    />
                    <input
                      value={editPublisher}
                      onChange={(e) => setEditPublisher(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                      placeholder="出版社"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                      placeholder="分类"
                    />
                    <input
                      value={editSubcategory}
                      onChange={(e) => setEditSubcategory(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                      placeholder="子分类"
                    />
                    <select
                      value={editLevel}
                      onChange={(e) => setEditLevel(e.target.value as BookLevel)}
                      className="w-full px-3 py-2 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                    >
                      <option value={BookLevel.BASIC}>入门</option>
                      <option value={BookLevel.ADVANCED}>进阶</option>
                      <option value={BookLevel.EXPERT}>专家</option>
                    </select>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={handleSaveEdit} leftIcon={<FloppyDisk className="w-4 h-4" />}>
                      保存
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setIsEditing(false);
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <Badge variant="default">{book.category}</Badge>
                    <CaretRight className="w-3 h-3 text-zinc-300" />
                    <Badge variant="default">{book.subcategory}</Badge>
                    {/* 使用可视化难度组件 */}
                    <DifficultyBadge level={book.level} size="sm" />
                    {book.rating && (
                      <Badge variant="default" className="bg-amber-50 text-amber-700 border-amber-200">
                        <Star className="w-3 h-3 text-amber-400 mr-1" weight="fill" />
                        {book.rating}
                      </Badge>
                    )}
                    <button
                      onClick={() => setIsEditing(true)}
                      className="ml-1 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                    >
                      <PencilSimple className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <h2 className="text-lg font-bold text-zinc-900 leading-tight">{book.title}</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">
                    {book.author}
                    {book.publisher && <span className="text-zinc-400"> · {book.publisher}</span>}
                  </p>
                </>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-2 -mr-2 -mt-2 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 md:p-6">
          {isUnread ? (
            <div className="text-center py-8 space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-accent-50 text-accent-600 flex items-center justify-center mx-auto">
                <BookOpen className="w-8 h-8" weight="regular" />
              </div>
              <div className="max-w-sm mx-auto">
                <h3 className="text-base font-semibold text-zinc-900 mb-1.5">开始阅读</h3>
                <p className="text-sm text-zinc-500 mb-5">
                  输入书籍总页数，AI 将为您生成个性化阅读指南。
                </p>
                <Card className="p-4 space-y-4">
                  <div className="text-left">
                    <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                      书籍总页数
                    </label>
                    <input
                      type="number"
                      value={totalPagesInput}
                      onChange={(e) => setTotalPagesInput(e.target.value)}
                      placeholder="例如: 320"
                      className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                    />
                  </div>
                  <Button
                    onClick={handleStartReading}
                    isLoading={isActivating}
                    disabled={!totalPagesInput}
                    fullWidth
                    leftIcon={<Play className="w-4 h-4" weight="fill" />}
                  >
                    开始阅读
                  </Button>
                </Card>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Tabs */}
              <div className="flex gap-1 border-b border-zinc-200 -mx-5 md:-mx-6 px-5 md:px-6">
                {(['insight', 'progress', 'douban'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={[
                      'pb-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors duration-200',
                      activeTab === tab
                        ? 'border-accent-500 text-accent-600'
                        : 'border-transparent text-zinc-400 hover:text-zinc-600',
                    ].join(' ')}
                  >
                    {tab === 'insight' ? 'AI 解读' : tab === 'progress' ? '进度追踪' : '豆瓣数据'}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {activeTab === 'insight' && book.aiInsight && (
                  <motion.div
                    key="insight"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    {/* 简介 */}
                    {book.aiInsight.summary && (
                      <Card variant="ghost" className="border-l-4 border-l-accent-500 bg-white">
                        <h4 className="flex items-center gap-2 text-xs font-semibold text-accent-700 uppercase tracking-wide mb-3">
                          <BookOpen className="w-4 h-4" weight="fill" />
                          简介
                        </h4>
                        <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
                          {book.aiInsight.summary}
                        </p>
                      </Card>
                    )}

                    {/* 阅读建议 */}
                    {book.aiInsight.advice && (
                      <Card variant="ghost" className="bg-amber-50/70 border-amber-200">
                        <h4 className="flex items-center gap-2 text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">
                          <Lightbulb className="w-4 h-4" weight="fill" />
                          阅读建议
                        </h4>
                        <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
                          {book.aiInsight.advice}
                        </p>
                      </Card>
                    )}

                    {/* 核心章节 */}
                    {book.aiInsight.keyChapters && book.aiInsight.keyChapters.length > 0 && (
                      <Card variant="ghost" className="bg-white">
                        <h4 className="flex items-center gap-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                          <Target className="w-4 h-4 text-accent-600" />
                          核心章节
                        </h4>
                        <div className="space-y-2.5">
                          {book.aiInsight.keyChapters.map((ch, i) => (
                            <div key={i} className="flex items-start gap-3 text-sm text-zinc-700">
                              <span className="w-5 h-5 rounded-full bg-accent-100 text-accent-700 text-xs font-medium flex items-center justify-center shrink-0 mt-0.5">
                                {i + 1}
                              </span>
                              <span className="leading-relaxed">{ch}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </motion.div>
                )}

                {activeTab === 'progress' && book.userData && (
                  <motion.div
                    key="progress"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    {/* Progress Card */}
                    <div className="rounded-2xl bg-zinc-900 text-white p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">
                            当前进度
                          </p>
                          <div className="text-4xl font-bold font-mono">
                            {Math.round(book.userData.progressPercentage)}%
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-1">
                            页码
                          </p>
                          <div className="text-xl font-semibold font-mono">
                            {book.userData.currentPage}
                            <span className="text-zinc-500 text-base font-normal ml-1">
                              / {book.userData.totalPages}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Progress Bar */}
                      <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${book.userData.progressPercentage}%` }}
                          transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                          className="h-full bg-accent-500 rounded-full"
                        />
                      </div>
                    </div>

                    {/* Update Progress */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Card>
                        <label className="block text-xs font-medium text-zinc-500 mb-2">
                          按页码更新
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            className="flex-1 px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                            value={currentPageInput}
                            onChange={(e) => setCurrentPageInput(e.target.value)}
                          />
                          <Button size="sm" onClick={() => updateProgress('page')}>
                            更新
                          </Button>
                        </div>
                      </Card>
                      <Card>
                        <label className="block text-xs font-medium text-zinc-500 mb-2">
                          按百分比更新
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            className="flex-1 px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                            value={percentageInput}
                            onChange={(e) => setPercentageInput(e.target.value)}
                          />
                          <Button size="sm" onClick={() => updateProgress('percent')}>
                            更新
                          </Button>
                        </div>
                      </Card>
                    </div>

                    {/* Completion Badge */}
                    {book.status === BookStatus.FINISHED && (
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex items-center justify-center gap-2 p-4 rounded-xl bg-success-50 text-success-700 border border-success-200"
                      >
                        <CheckCircle className="w-5 h-5" weight="fill" />
                        <span className="text-sm font-medium">
                          阅读完成于{' '}
                          {new Date(book.userData.completionDate || '').toLocaleDateString()}
                        </span>
                      </motion.div>
                    )}

                    {/* 取消阅读 */}
                    {book.status === BookStatus.READING && (
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            onUpdate({
                              ...book,
                              status: BookStatus.UNREAD,
                              userData: undefined,
                            });
                          }}
                          className="text-zinc-400 hover:text-danger-600"
                        >
                          取消阅读
                        </Button>
                      </div>
                    )}
                  </motion.div>
                )}

                {activeTab === 'insight' && isGeneratingInsight && (
                  <motion.div
                    key="generating"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="py-6"
                  >
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 md:p-5">
                      <div className="flex gap-3">
                        <div className="w-9 h-9 rounded-full bg-zinc-900 text-white flex items-center justify-center shrink-0">
                          <motion.div
                            animate={{ scale: [1, 1.1, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                          >
                            <Lightbulb className="w-4 h-4" weight="fill" />
                          </motion.div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">正在生成 AI 解读</h4>
                          <AIActivityPanel
                            phase={ai.phase}
                            toolCalls={ai.toolCalls}
                            reasoningText={ai.reasoningText}
                            elapsedTime={ai.elapsedTime}
                            receivedChars={ai.receivedChars}
                            onCancel={handleStopInsight}
                            thinkingLabel="正在分析书籍信息"
                            generatingLabel="正在生成解读内容"
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'insight' && !book.aiInsight && !isGeneratingInsight && (
                  <motion.div
                    key="no-insight"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="text-center py-12 text-zinc-400"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-zinc-50 flex items-center justify-center mx-auto mb-4">
                      <Lightbulb className="w-8 h-8 text-zinc-300" />
                    </div>
                    <p className="text-sm font-medium text-zinc-600 mb-1">暂无 AI 解读</p>
                    <p className="text-xs text-zinc-400">点击"开始阅读"生成个性化解读</p>
                  </motion.div>
                )}

                {/* 豆瓣数据 Tab */}
                {activeTab === 'douban' && doubanData && (
                  <motion.div
                    key="douban"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    {/* 评分 */}
                    <Card variant="ghost" className="bg-amber-50/70 border-amber-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                            <Star className="w-6 h-6 text-amber-600" weight="fill" />
                          </div>
                          <div>
                            <div className="flex items-baseline gap-1">
                              <span className="text-3xl font-bold text-amber-700">{doubanData.rating_score}</span>
                              <span className="text-sm text-amber-600">/10</span>
                            </div>
                            <p className="text-xs text-amber-600">{doubanData.rating_count?.toLocaleString()} 人评价</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            豆瓣评分
                          </span>
                        </div>
                      </div>
                    </Card>

                    {/* 基本信息 */}
                    <Card variant="ghost" className="bg-white">
                      <h4 className="flex items-center gap-2 text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-4">
                        <Building className="w-4 h-4" />
                        出版信息
                      </h4>
                      <div className="space-y-3 text-sm">
                        {doubanData.publisher && (
                          <div className="flex items-center gap-3">
                            <span className="w-16 text-zinc-400 text-xs">出版社</span>
                            <span className="text-zinc-700 font-medium">{doubanData.publisher}</span>
                          </div>
                        )}
                        {(doubanData.pubdate || doubanData.publish_year) && (
                          <div className="flex items-center gap-3">
                            <span className="w-16 text-zinc-400 text-xs">出版日期</span>
                            <span className="text-zinc-700">{doubanData.pubdate || doubanData.publish_year}</span>
                          </div>
                        )}
                        {doubanData.pages && (
                          <div className="flex items-center gap-3">
                            <span className="w-16 text-zinc-400 text-xs">页数</span>
                            <span className="text-zinc-700">{doubanData.pages} 页</span>
                          </div>
                        )}
                        {doubanData.isbn13 && (
                          <div className="flex items-center gap-3">
                            <span className="w-16 text-zinc-400 text-xs">ISBN</span>
                            <span className="text-zinc-700 font-mono text-xs">{doubanData.isbn13}</span>
                          </div>
                        )}
                      </div>
                    </Card>

                    {/* 简介 */}
                    {doubanData.summary && (
                      <Card variant="ghost" className="border-l-4 border-l-accent-500 bg-white">
                        <h4 className="flex items-center gap-2 text-xs font-semibold text-accent-700 uppercase tracking-wide mb-3">
                          <BookOpen className="w-4 h-4" weight="fill" />
                          内容简介
                        </h4>
                        <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
                          {doubanData.summary}
                        </p>
                      </Card>
                    )}

                    {/* 阅读状态统计 */}
                    {doubanData.reading_status && (
                      <Card variant="ghost" className="bg-white">
                        <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                          阅读统计
                        </h4>
                        <div className="flex gap-4 text-sm">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-accent-500" />
                            <span className="text-zinc-600">在读 {doubanData.reading_status.reading}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-success-500" />
                            <span className="text-zinc-600">已读 {doubanData.reading_status.read}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-zinc-300" />
                            <span className="text-zinc-600">想读 {doubanData.reading_status.want_to_read}</span>
                          </div>
                        </div>
                      </Card>
                    )}
                  </motion.div>
                )}

                {activeTab === 'douban' && !doubanData && (
                  <motion.div
                    key="no-douban"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="text-center py-12 text-zinc-400"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-zinc-50 flex items-center justify-center mx-auto mb-4">
                      <BookOpen className="w-8 h-8 text-zinc-300" />
                    </div>
                    <p className="text-sm font-medium text-zinc-600 mb-1">暂无豆瓣数据</p>
                    <p className="text-xs text-zinc-400">添加书籍时会自动获取豆瓣信息</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

// Generate a consistent color from string
function generateColor(str: string): string {
  const colors = [
    '#4f46e5', '#7c3aed', '#2563eb', '#0891b2', '#059669',
    '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
