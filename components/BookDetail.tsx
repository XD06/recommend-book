import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, BookStatus, BookLevel, getBookCoverUrl, hasBookCover } from '../types';
import { Button } from './Button';
import { Card } from './Card';
import { Badge } from './Badge';
import { DifficultyBadge, DifficultyScale } from './DifficultyBadge';
import { generateInsightStream } from '../services/geminiService';
import { refreshBookDouban, deleteBook } from '../services/bookService';
import { AIActivityPanel, useAIActivity } from './AIActivityPanel';
import { BookQA } from './BookQA';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
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
  ArrowsClockwise,
  Trash,
} from '@phosphor-icons/react';

interface BookDetailProps {
  book: Book;
  onClose: () => void;
  onUpdate: (updatedBook: Book, silent?: boolean) => void;
  /** 删除后回调：由上层把这本书从书库移除并关掉详情 */
  onDelete?: (bookId: string) => void;
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

export const BookDetail: React.FC<BookDetailProps> = ({ book, onClose, onUpdate, onDelete }) => {
  const { showSuccess, showError } = useToast();
  const { confirm } = useConfirm();
  const [isActivating, setIsActivating] = useState(false);
  const [activeTab, setActiveTab] = useState<'insight' | 'progress' | 'douban' | 'qa'>('insight');
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
  // 豆瓣数据重新抓取中
  const [isRefreshingDouban, setIsRefreshingDouban] = useState(false);
  // 删除进行中
  const [isDeleting, setIsDeleting] = useState(false);

  // 流式 AI 状态
  const ai = useAIActivity();
  const abortRef = useRef<AbortController | null>(null);

  // 卸载即中止，否则遗留的流会一直占住浏览器单域名 6 连接池里的一条（见 AIAdvisor 同名 effect）
  useEffect(() => () => abortRef.current?.abort(), []);

  const isUnread = book.status === BookStatus.UNREAD;
  const coverColor = book.coverColor || generateColor(book.title);
  
  // 豆瓣数据
  const doubanData = book.doubanData;
  
  const handleSaveEdit = () => {
    const totalPages = parseInt(totalPagesInput) || book.userData?.totalPages || 0;
    onUpdate({
      ...book,
      title: editTitle,
      author: editAuthor,
      publisher: editPublisher,
      category: editCategory,
      subcategory: editSubcategory,
      level: editLevel,
      userData: book.userData ? { ...book.userData, totalPages } : (totalPages > 0 ? { totalPages, currentPage: 0, progressPercentage: 0 } : undefined),
    });
    setIsEditing(false);
  };

  /**
   * 删除这本书。
   *
   * 走二次确认，且明确告知"不可撤销"——删掉会连阅读进度、AI 解读、自评星级
   * 一起没了（那是这本书独有的数据，删了没有地方恢复）。
   */
  const handleDelete = async () => {
    const ok = await confirm({
      title: `删除《${book.title}》？`,
      message: '这本书的阅读进度、AI 解读和评分会一起删除，且无法恢复。',
      confirmLabel: '删除',
      variant: 'danger',
    });
    if (!ok) return;

    setIsDeleting(true);
    try {
      await deleteBook(book.id);
      showSuccess('已移出书库');
      onDelete?.(book.id);
      onClose();
    } catch (err) {
      showError(`删除失败：${(err as Error).message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * 重新抓取豆瓣数据。
   *
   * 存在的理由：导入时豆瓣抓取可能失败（Python 缺失/超时/限流），书库里就留下
   * 只有书名、没有封面/出版社/评分/简介的书。以前只能删了重加 —— 那会把阅读
   * 进度、AI 解读、自评星级一起丢掉。后端只填补空白字段，不会覆盖手改过的内容。
   */
  const handleRefreshDouban = async () => {
    setIsRefreshingDouban(true);
    try {
      const { book: updated, replaced } = await refreshBookDouban(book.id);
      onUpdate(updated, true);
      if (replaced) {
        showSuccess('已补全豆瓣信息');
      } else {
        showSuccess('豆瓣上没有比现在更完整的数据，已保留原信息');
      }
    } catch (e: any) {
      showError(e.message || '重新抓取失败');
    } finally {
      setIsRefreshingDouban(false);
    }
  };

  const handleStartReading = async () => {
    setIsActivating(true);
    setIsGeneratingInsight(true);
    ai.reset();
    ai.startTimer();

    const controller = new AbortController();
    abortRef.current = controller;

    // 预先计算阅读参数
    const totalPages = parseInt(totalPagesInput) || doubanData?.pages || 300;
    const newUserData = {
      totalPages,
      currentPage: 0,
      progressPercentage: 0,
      startDate: new Date().toISOString(),
    };

    // 静默更新阅读状态（不弹 toast）
    onUpdate({
      ...book,
      status: BookStatus.READING,
      userData: newUserData,
    }, true);

    try {
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
          totalPages,
          doubanData: doubanDataForAI,
        },
        {
          onPhase: (phase) => ai.handlePhase(phase),
          onToolCall: (toolName, label, round) => ai.handleToolCall(toolName, label, round),
          onChunk: (chunk) => ai.handleChunk(chunk),
          onReasoning: ai.handleReasoning,
          // 解读也能改书（Agent 有 update_book_status），不接住这条事件，
          // 下面 onUpdate 触发的全量保存会把 AI 刚写进 SQLite 的状态冲掉
          onBookUpdate: (bookId, updates) => {
            window.dispatchEvent(new CustomEvent('aiBookUpdate', { detail: { bookId, updates } }));
          },
        },
        controller.signal,
      );
      
      // 保存 AI 解读（静默，因为下面会自己弹 toast）
      onUpdate({
        ...book,
        status: BookStatus.READING,
        aiInsight: insight,
        userData: newUserData,
      }, true);
      
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
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">总页数</label>
                      <input
                        type="number"
                        value={totalPagesInput}
                        onChange={(e) => setTotalPagesInput(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                        placeholder="如 320"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1">我的评分 (1-5 星)</label>
                      <select
                        value={book.userRating ?? book.userData?.userRating ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? parseInt(e.target.value) : undefined;
                          // 星级与阅读进度同住 userData；写入时要带上原有进度，否则会把进度冲掉。
                          // 不再写 book.rating —— 那个字段里躺着导入期的豆瓣分（10 分制）。
                          const merged = { ...(book.userData || { totalPages: 0, currentPage: 0, progressPercentage: 0 }) } as any;
                          if (val === undefined) delete merged.userRating;
                          else merged.userRating = val;
                          onUpdate({ ...book, userRating: val, userData: merged }, true);
                        }}
                        className="w-full px-3 py-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500"
                      >
                        <option value="">未评分</option>
                        <option value="1">1 星</option>
                        <option value="2">2 星</option>
                        <option value="3">3 星</option>
                        <option value="4">4 星</option>
                        <option value="5">5 星</option>
                      </select>
                    </div>
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
                    {/* 豆瓣分与我的评分分开显示：豆瓣是 10 分制的大众评分，
                        混在一个位置展示会让人以为那是自己打的分 */}
                    {(doubanData?.rating_score ?? (book.rating && book.rating > 5 ? book.rating : undefined)) !== undefined && (
                      <Badge variant="default" className="bg-amber-50 text-amber-700 border-amber-200">
                        <Star className="w-3 h-3 text-amber-400 mr-1" weight="fill" />
                        豆瓣 {(doubanData?.rating_score ?? book.rating)!.toFixed(1)}
                      </Badge>
                    )}
                    {(book.userRating ?? book.userData?.userRating) !== undefined && (
                      <Badge variant="default" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                        我的评分 {book.userRating ?? book.userData?.userRating}★
                      </Badge>
                    )}
                    <button
                      onClick={() => setIsEditing(true)}
                      className="ml-1 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                      title="编辑书籍信息"
                    >
                      <PencilSimple className="w-3.5 h-3.5" />
                    </button>
                    {/* 豆瓣数据缺失/不完整时给一个显眼的补抓入口：
                        抓取失败的书通常正是未读的，所以这个按钮在未读态也要有 */}
                    {(!doubanData || !doubanData.summary || !doubanData.cover_url) && (
                      <button
                        onClick={handleRefreshDouban}
                        disabled={isRefreshingDouban}
                        className="ml-1 px-2 py-1 rounded-lg text-[11px] font-medium text-accent-700 bg-accent-50 hover:bg-accent-100 border border-accent-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                        title="从豆瓣重新抓取这本书的封面、出版社、评分与简介"
                      >
                        <ArrowsClockwise
                          className={`w-3 h-3 ${isRefreshingDouban ? 'animate-spin' : ''}`}
                        />
                        {isRefreshingDouban ? '抓取中…' : '补全豆瓣信息'}
                      </button>
                    )}
                  </div>
                  <h2 className="text-lg font-bold text-zinc-900 leading-tight">{book.title}</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">
                    {book.author}
                    {book.publisher && <span className="text-zinc-400"> · {book.publisher}</span>}
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* 删除放在最右，与关闭按钮相邻但样式区分开（灰→红 hover），
                  避免误点：它的 hover 变红，而关闭是变黑 */}
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="p-2 -mt-2 rounded-lg text-zinc-400 hover:text-danger-600 hover:bg-danger-50 transition-colors disabled:opacity-50"
                title="删除这本书"
              >
                <Trash className={`w-5 h-5 ${isDeleting ? 'animate-pulse' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 -mr-2 -mt-2 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
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
              <div className="flex gap-1 border-b border-zinc-200 -mx-5 md:-mx-6 px-5 md:px-6 overflow-x-auto no-scrollbar">
                {(['insight', 'progress', 'qa', 'douban'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={[
                      'shrink-0 whitespace-nowrap pb-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors duration-200',
                      activeTab === tab
                        ? 'border-accent-500 text-accent-600'
                        : 'border-transparent text-zinc-400 hover:text-zinc-600',
                    ].join(' ')}
                  >
                    {tab === 'insight' ? 'AI 解读' : tab === 'progress' ? '进度追踪' : tab === 'qa' ? '书籍问答' : '豆瓣数据'}
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
                            }, true);
                            showSuccess('已取消阅读');
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
streamingText={ai.streamingText}
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

                {/* 问答 Tab */}
                {activeTab === 'qa' && (
                  <motion.div
                    key="qa"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <BookQA book={book} />
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
                    <p className="text-xs text-zinc-400 mb-4">
                      这本书导入时没能抓到豆瓣信息，可以重新抓一次
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleRefreshDouban}
                      isLoading={isRefreshingDouban}
                      leftIcon={<ArrowsClockwise className="w-4 h-4" />}
                    >
                      重新抓取豆瓣数据
                    </Button>
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
