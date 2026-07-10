import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  SquaresFour,
  List,
  Faders,
  Plus,
  MagnifyingGlass,
  Books,
  ChartPie,
  Clock,
  CheckCircle,
  ArrowRight,
  SortAscending,
} from '@phosphor-icons/react';
import { Book, BookStatus, BookLevel, CategoryGroup, getBookCoverUrl, hasBookCover } from '../types';
import { BookCard } from './BookCard';
import { Card } from './Card';
import { Button } from './Button';
import { ReadingTimeline } from './ReadingTimeline';
import { ReadingHeatmap } from './ReadingHeatmap';

interface LibraryViewProps {
  books: Book[];
  categories: CategoryGroup[];
  onSelectBook: (book: Book) => void;
  onImportClick: () => void;
}

type ViewMode = 'grid' | 'list';
type FilterStatus = 'all' | BookStatus;
type FilterLevel = 'all' | BookLevel;
type SortOption = 'recent' | 'title' | 'author' | 'rating' | 'progress';

export const LibraryView: React.FC<LibraryViewProps> = ({
  books,
  categories,
  onSelectBook,
  onImportClick,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterLevel, setFilterLevel] = useState<FilterLevel>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('recent');

  // Stats
  const stats = useMemo(() => {
    const total = books.length;
    const reading = books.filter((b) => b.status === BookStatus.READING).length;
    const finished = books.filter((b) => b.status === BookStatus.FINISHED).length;
    const unread = total - reading - finished;
    return { total, reading, finished, unread };
  }, [books]);

  // Filtered and sorted books
  const filteredBooks = useMemo(() => {
    let result = books.filter((book) => {
      // Search
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          book.title.toLowerCase().includes(query) ||
          book.author.toLowerCase().includes(query) ||
          book.category.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      // Category
      if (selectedCategory && book.category !== selectedCategory) return false;
      // Status
      if (filterStatus !== 'all' && book.status !== filterStatus) return false;
      // Level
      if (filterLevel !== 'all' && book.level !== filterLevel) return false;
      return true;
    });

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title, 'zh-CN');
        case 'author':
          return a.author.localeCompare(b.author, 'zh-CN');
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
        case 'progress':
          return (b.userData?.progressPercentage || 0) - (a.userData?.progressPercentage || 0);
        case 'recent':
        default:
          // Sort by last activity (start date or completion date)
          const aDate = a.userData?.completionDate || a.userData?.startDate || '';
          const bDate = b.userData?.completionDate || b.userData?.startDate || '';
          return bDate.localeCompare(aDate);
      }
    });

    return result;
  }, [books, searchQuery, selectedCategory, filterStatus, filterLevel, sortBy]);

  // Currently reading books
  const readingBooks = useMemo(
    () => books.filter((b) => b.status === BookStatus.READING).slice(0, 3),
    [books]
  );

  return (
    <div className="space-y-6 pt-20 pb-24 md:pb-8">
      {/* Hero Section - Current Reading */}
      {readingBooks.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
              <Clock weight="fill" className="w-5 h-5 text-accent-600" />
              正在阅读
            </h2>
            <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="w-4 h-4" />}>
              查看全部
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {readingBooks.map((book, index) => (
              <ReadingProgressCard
                key={book.id}
                book={book}
                onClick={() => onSelectBook(book)}
                index={index}
              />
            ))}
          </div>
        </motion.section>
      )}

      {/* Stats Overview */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="藏书总数"
            value={stats.total}
            icon={Books}
            color="zinc"
          />
          <StatCard
            label="正在阅读"
            value={stats.reading}
            icon={Clock}
            color="accent"
          />
          <StatCard
            label="已读完"
            value={stats.finished}
            icon={CheckCircle}
            color="success"
          />
          <StatCard
            label="分类数量"
            value={categories.length}
            icon={ChartPie}
            color="warning"
          />
        </div>
      </motion.section>

      {/* Filters & Search */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
        className="sticky top-20 z-30"
      >
        <Card variant="elevated" padding="md">
          <div className="flex flex-col gap-4">
            {/* Search & View Toggle */}
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  placeholder="搜索书籍、作者..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500 transition-all"
                />
              </div>
              <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-md transition-all ${
                    viewMode === 'grid'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  <SquaresFour className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-md transition-all ${
                    viewMode === 'list'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`p-2.5 rounded-lg border transition-all ${
                  showFilters
                    ? 'bg-accent-50 border-accent-200 text-accent-600'
                    : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
                }`}
              >
                <Faders className="w-4 h-4" />
              </button>

              {/* Sort Dropdown */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="appearance-none bg-zinc-100 border border-zinc-200 text-zinc-700 text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500 cursor-pointer"
                >
                  <option value="recent">最近活动</option>
                  <option value="title">书名</option>
                  <option value="author">作者</option>
                  <option value="rating">评分</option>
                  <option value="progress">进度</option>
                </select>
                <SortAscending className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
              </div>
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-full transition-all ${
                  selectedCategory === null
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                全部
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() =>
                    setSelectedCategory(cat.name === selectedCategory ? null : cat.name)
                  }
                  className={`shrink-0 px-3 py-1.5 text-sm font-medium rounded-full transition-all flex items-center gap-1.5 ${
                    selectedCategory === cat.name
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  {cat.name}
                  <span className="text-xs opacity-60">{cat.count}</span>
                </button>
              ))}
            </div>

            {/* Advanced Filters */}
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3 border-t border-zinc-100 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">状态:</span>
                      <div className="flex items-center gap-1">
                        {(['all', BookStatus.READING, BookStatus.FINISHED, BookStatus.UNREAD] as const).map(
                          (status) => (
                            <button
                              key={status}
                              onClick={() => setFilterStatus(status)}
                              className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                                filterStatus === status
                                  ? 'bg-zinc-900 text-white'
                                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                              }`}
                            >
                              {status === 'all'
                                ? '全部'
                                : status === BookStatus.READING
                                ? '阅读中'
                                : status === BookStatus.FINISHED
                                ? '已读完'
                                : '未开始'}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">难度:</span>
                      <div className="flex items-center gap-1">
                        {(['all', BookLevel.BASIC, BookLevel.ADVANCED, BookLevel.EXPERT] as const).map(
                          (level) => (
                            <button
                              key={level}
                              onClick={() => setFilterLevel(level)}
                              className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                                filterLevel === level
                                  ? 'bg-zinc-900 text-white'
                                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                              }`}
                            >
                              {level === 'all'
                                ? '全部'
                                : level === BookLevel.BASIC
                                ? '入门'
                                : level === BookLevel.ADVANCED
                                ? '进阶'
                                : '专家'}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </motion.section>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Books Grid - Main Area */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="lg:col-span-3"
        >
          {filteredBooks.length === 0 ? (
            <EmptyState onAddClick={onImportClick} />
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredBooks.map((book, index) => (
                <motion.div
                  key={book.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.4,
                    delay: index * 0.05,
                    ease: [0.23, 1, 0.32, 1],
                  }}
                >
                  <BookCard
                    book={book}
                    onClick={() => onSelectBook(book)}
                    size="small"
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredBooks.map((book, index) => (
                <motion.div
                key={book.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  delay: index * 0.05,
                  ease: [0.23, 1, 0.32, 1],
                }}
              >
                <BookCard
                  book={book}
                  onClick={() => onSelectBook(book)}
                  size="medium"
                />
              </motion.div>
            ))}
          </div>
        )}
        </motion.section>

        {/* Sidebar */}
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="hidden lg:block space-y-6"
        >
          <ReadingTimeline books={books} onSelectBook={onSelectBook} />
          <ReadingHeatmap books={books} />
        </motion.aside>
      </div>
    </div>
  );
};

// Reading Progress Card
interface ReadingProgressCardProps {
  book: Book;
  onClick: () => void;
  index: number;
}

const ReadingProgressCard: React.FC<ReadingProgressCardProps> = ({
  book,
  onClick,
  index,
}) => {
  const progress = book.userData?.progressPercentage || 0;
  const coverColor = book.coverColor || '#4f46e5';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1, ease: [0.23, 1, 0.32, 1] }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="cursor-pointer"
    >
      <Card hover className="flex items-center gap-4">
        {/* 优先使用豆瓣封面 */}
        {hasBookCover(book) ? (
          <img
            src={getBookCoverUrl(book)}
            alt={book.title}
            className="w-14 h-20 rounded-lg shadow-sm flex-shrink-0 object-cover"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              const parent = target.parentElement;
              if (parent) {
                parent.innerHTML = `<div class="w-14 h-20 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center p-2" style="background-color: ${coverColor}"><span class="text-white text-xs font-medium text-center line-clamp-2">${book.title}</span></div>`;
              }
            }}
          />
        ) : (
          <div
            className="w-14 h-20 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center p-2"
            style={{ backgroundColor: coverColor }}
          >
            <span className="text-white text-xs font-medium text-center line-clamp-2">
              {book.title}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-zinc-900 text-sm line-clamp-1">{book.title}</h4>
          <p className="text-xs text-zinc-500 mt-0.5">{book.author}</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
              <span>进度</span>
              <span className="font-medium text-accent-600">{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.8, delay: 0.3 + index * 0.1, ease: [0.23, 1, 0.32, 1] }}
                className="h-full bg-accent-500 rounded-full"
              />
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
};

// Stat Card
interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  color: 'zinc' | 'accent' | 'success' | 'warning';
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, color }) => {
  const colorStyles = {
    zinc: 'bg-zinc-100 text-zinc-600',
    accent: 'bg-accent-50 text-accent-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
  };

  return (
    <Card className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorStyles[color]}`}>
        <Icon weight="fill" className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-bold text-zinc-900 font-mono">{value}</div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
    </Card>
  );
};

// Empty State - 首次使用引导
const EmptyState: React.FC<{ onAddClick: () => void }> = ({ onAddClick }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      className="w-24 h-24 rounded-3xl bg-gradient-to-br from-accent-100 to-accent-50 flex items-center justify-center mb-6"
    >
      <Books className="w-12 h-12 text-accent-600" />
    </motion.div>
    <motion.h3
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="text-xl font-semibold text-zinc-900 mb-2"
    >
      欢迎来到 DeepRead
    </motion.h3>
    <motion.p
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="text-sm text-zinc-500 mb-2 max-w-sm"
    >
      你的 AI 驱动个人图书馆
    </motion.p>
    <motion.p
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="text-xs text-zinc-400 mb-8 max-w-xs"
    >
      通过 AI 分类整理书籍，获取个性化阅读推荐，追踪阅读进度
    </motion.p>
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="flex flex-col sm:flex-row gap-3"
    >
      <Button onClick={onAddClick} leftIcon={<Plus className="w-4 h-4" />} size="lg">
        添加第一本书
      </Button>
    </motion.div>
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className="mt-6 text-xs text-zinc-400"
    >
      支持从豆瓣导入、批量添加、JSON 导入等多种方式
    </motion.p>
  </div>
);
