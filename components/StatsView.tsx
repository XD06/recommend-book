import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  ChartPie,
  TrendUp,
  BookOpen,
  Clock,
  CheckCircle,
  Stack,
  Star,
} from '@phosphor-icons/react';
import { Book, BookStatus, BookLevel, CategoryGroup, getBookCoverUrl, hasBookCover } from '../types';
import { Card, CardHeader } from './Card';
import { Badge } from './Badge';
import { ReadingHeatmap } from './ReadingHeatmap';
import { ReadingTimeline } from './ReadingTimeline';
import { DifficultyScale } from './DifficultyBadge';

interface StatsViewProps {
  books: Book[];
  categories: CategoryGroup[];
}

export const StatsView: React.FC<StatsViewProps> = ({ books, categories }) => {
  const stats = useMemo(() => {
    const total = books.length;
    const reading = books.filter((b) => b.status === BookStatus.READING);
    const finished = books.filter((b) => b.status === BookStatus.FINISHED);
    const unread = books.filter((b) => b.status === BookStatus.UNREAD);

    // Pages read
    let totalPagesRead = 0;
    let totalPages = 0;
    books.forEach((b) => {
      if (b.userData) {
        totalPages += b.userData.totalPages;
        totalPagesRead +=
          b.status === BookStatus.FINISHED
            ? b.userData.totalPages
            : b.userData.currentPage;
      }
    });

    // Level distribution
    const levels = {
      [BookLevel.BASIC]: books.filter((b) => b.level === BookLevel.BASIC).length,
      [BookLevel.ADVANCED]: books.filter((b) => b.level === BookLevel.ADVANCED).length,
      [BookLevel.EXPERT]: books.filter((b) => b.level === BookLevel.EXPERT).length,
    };

    // Rating average
    const ratedBooks = books.filter((b) => b.rating);
    const avgRating =
      ratedBooks.length > 0
        ? ratedBooks.reduce((sum, b) => sum + (b.rating || 0), 0) / ratedBooks.length
        : 0;

    return {
      total,
      reading: reading.length,
      finished: finished.length,
      unread: unread.length,
      readingBooks: reading,
      finishedBooks: finished,
      totalPagesRead,
      totalPages,
      levels,
      avgRating,
      ratedCount: ratedBooks.length,
    };
  }, [books]);

  return (
    <div className="space-y-6 pt-20 pb-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      >
        <h1 className="text-2xl font-bold text-zinc-900">阅读统计</h1>
        <p className="text-zinc-500 mt-1">追踪你的阅读进度和习惯</p>
      </motion.div>

      {/* Overview Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <StatCard
          label="藏书总数"
          value={stats.total}
          icon={Stack}
          color="zinc"
          subtitle="本书"
        />
        <StatCard
          label="正在阅读"
          value={stats.reading}
          icon={Clock}
          color="accent"
          subtitle="本"
        />
        <StatCard
          label="已读完"
          value={stats.finished}
          icon={CheckCircle}
          color="success"
          subtitle="本"
        />
        <StatCard
          label="累计页数"
          value={stats.totalPagesRead.toLocaleString()}
          icon={BookOpen}
          color="warning"
          subtitle="页"
        />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Currently Reading & Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="lg:col-span-2 space-y-6"
        >
          {/* Currently Reading */}
          <Card>
            <CardHeader
              title="正在阅读"
              subtitle={`${stats.reading} 本书进行中`}
              action={
                stats.reading > 0 && (
                  <Badge variant="primary" dot>
                    进行中
                  </Badge>
                )
              }
            />
            {stats.readingBooks.length === 0 ? (
              <EmptyState icon={BookOpen} message="当前没有正在阅读的书籍" />
            ) : (
              <div className="space-y-4">
                {stats.readingBooks.map((book, index) => (
                  <ReadingProgressItem key={book.id} book={book} index={index} />
                ))}
              </div>
            )}
          </Card>

          {/* Reading Timeline */}
          <ReadingTimeline 
            books={books} 
            onSelectBook={(book) => {
              // 通过自定义事件通知 App 打开书籍详情
              window.dispatchEvent(new CustomEvent('openBookDetail', { detail: book }));
            }}
          />
        </motion.div>

        {/* Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="space-y-6"
        >
          {/* Reading Heatmap */}
          <ReadingHeatmap books={books} />

          {/* Level Distribution with Visual Scale */}
          <Card>
            <CardHeader title="难度分布" icon={<ChartPie className="w-5 h-5 text-accent-600" />} />
            <div className="space-y-4">
              <DistributionBar
                label="入门"
                count={stats.levels[BookLevel.BASIC]}
                total={stats.total}
                color="bg-success-500"
                textColor="text-success-700"
              />
              <DistributionBar
                label="进阶"
                count={stats.levels[BookLevel.ADVANCED]}
                total={stats.total}
                color="bg-accent-500"
                textColor="text-accent-700"
              />
              <DistributionBar
                label="专家"
                count={stats.levels[BookLevel.EXPERT]}
                total={stats.total}
                color="bg-danger-500"
                textColor="text-danger-700"
              />
            </div>
            
            {/* 难度说明 */}
            <div className="mt-4 pt-4 border-t border-zinc-100">
              <p className="text-xs text-zinc-500 mb-2">难度级别说明</p>
              <DifficultyScale currentLevel={BookLevel.BASIC} />
            </div>
          </Card>

          {/* Category Ranking */}
          <Card>
            <CardHeader title="热门分类" icon={<TrendUp className="w-5 h-5 text-accent-600" />} />
            <div className="space-y-2">
              {categories
                .sort((a, b) => b.count - a.count)
                .slice(0, 5)
                .map((cat, idx) => (
                  <div
                    key={cat.name}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 hover:bg-zinc-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <RankBadge rank={idx + 1} />
                      <span className="text-sm font-medium text-zinc-700">{cat.name}</span>
                    </div>
                    <span className="text-xs font-mono text-zinc-400">{cat.count} 本</span>
                  </div>
                ))}
              {categories.length === 0 && (
                <p className="text-sm text-zinc-400 text-center py-4">暂无数据</p>
              )}
            </div>
          </Card>

          {/* Rating Stats */}
          {stats.ratedCount > 0 && (
            <Card>
              <CardHeader title="评分统计" icon={<Star className="w-5 h-5 text-accent-600" />} />
              <div className="flex items-center gap-4">
                <div className="text-4xl font-bold text-zinc-900 font-mono">
                  {stats.avgRating.toFixed(1)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1 text-amber-400">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        weight={star <= Math.round(stats.avgRating) ? 'fill' : 'regular'}
                        className="w-4 h-4"
                      />
                    ))}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    基于 {stats.ratedCount} 本书的评分
                  </p>
                </div>
              </div>
            </Card>
          )}
        </motion.div>
      </div>
    </div>
  );
};

// Stat Card
interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: 'zinc' | 'accent' | 'success' | 'warning';
  subtitle?: string;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, icon: Icon, color, subtitle }) => {
  const colorStyles = {
    zinc: 'bg-zinc-100 text-zinc-600',
    accent: 'bg-accent-50 text-accent-600',
    success: 'bg-success-50 text-success-600',
    warning: 'bg-warning-50 text-warning-600',
  };

  return (
    <Card className="flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorStyles[color]}`}>
        <Icon weight="fill" className="w-6 h-6" />
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-zinc-900 font-mono">{value}</span>
          {subtitle && <span className="text-sm text-zinc-500">{subtitle}</span>}
        </div>
        <div className="text-xs text-zinc-500">{label}</div>
      </div>
    </Card>
  );
};

// Reading Progress Item
const ReadingProgressItem: React.FC<{ book: Book; index: number }> = ({ book, index }) => {
  const progress = book.userData?.progressPercentage || 0;
  const coverColor = book.coverColor || '#4f46e5';

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1, ease: [0.23, 1, 0.32, 1] }}
      className="flex items-center gap-4 p-3 rounded-xl bg-zinc-50 hover:bg-zinc-100 transition-colors"
    >
      {/* 优先使用豆瓣封面 */}
      {hasBookCover(book) ? (
        <img
          src={getBookCoverUrl(book)}
          alt={book.title}
          className="w-12 h-16 rounded-lg shadow-sm flex-shrink-0 object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const parent = target.parentElement;
            if (parent) {
              parent.innerHTML = `<div class="w-12 h-16 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center p-1" style="background-color: ${coverColor}"><span class="text-white text-[10px] font-medium text-center line-clamp-2">${book.title}</span></div>`;
            }
          }}
        />
      ) : (
        <div
          className="w-12 h-16 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center p-1"
          style={{ backgroundColor: coverColor }}
        >
          <span className="text-white text-[10px] font-medium text-center line-clamp-2">
            {book.title}
          </span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-zinc-900 text-sm line-clamp-1">{book.title}</h4>
        <p className="text-xs text-zinc-500">{book.author}</p>
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
            <span>
              {book.userData?.currentPage || 0} / {book.userData?.totalPages || '?'} 页
            </span>
            <span className="font-medium text-accent-600">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 bg-zinc-200 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.8, delay: 0.3 + index * 0.1, ease: [0.23, 1, 0.32, 1] }}
              className="h-full bg-accent-500 rounded-full"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Distribution Bar
const DistributionBar: React.FC<{
  label: string;
  count: number;
  total: number;
  color: string;
  textColor: string;
}> = ({ label, count, total, color, textColor }) => {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-medium ${textColor}`}>{label}</span>
        <span className="text-xs text-zinc-400">
          {count} 本 ({Math.round(percentage)}%)
        </span>
      </div>
      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
          className={`h-full ${color} rounded-full`}
        />
      </div>
    </div>
  );
};

// Rank Badge
const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  const colors = [
    'bg-amber-100 text-amber-700',
    'bg-zinc-200 text-zinc-600',
    'bg-orange-100 text-orange-700',
    'bg-zinc-100 text-zinc-500',
  ];
  const colorClass = colors[Math.min(rank - 1, 3)];

  return (
    <span
      className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${colorClass}`}
    >
      {rank}
    </span>
  );
};

// Empty State
const EmptyState: React.FC<{ icon: React.ElementType; message: string }> = ({
  icon: Icon,
  message,
}) => (
  <div className="flex flex-col items-center justify-center py-8 text-center">
    <Icon className="w-10 h-10 text-zinc-300 mb-2" />
    <p className="text-sm text-zinc-500">{message}</p>
  </div>
);
