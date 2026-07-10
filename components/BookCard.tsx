import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle, Clock, Star, BookOpen, Calendar, Building } from '@phosphor-icons/react';
import { Book, BookStatus, BookLevel, getBookCoverUrl, hasBookCover } from '../types';
import { Card } from './Card';
import { Badge } from './Badge';
import { DifficultyBadge } from './DifficultyBadge';

interface BookCardProps {
  book: Book;
  onClick: () => void;
  rank?: number;
  size?: 'small' | 'medium' | 'large';
}


const levelLabels: Record<BookLevel, string> = {
  [BookLevel.BASIC]: '入门',
  [BookLevel.ADVANCED]: '进阶',
  [BookLevel.EXPERT]: '专家',
};

const statusIcons = {
  [BookStatus.UNREAD]: null,
  [BookStatus.READING]: Clock,
  [BookStatus.FINISHED]: CheckCircle,
};

const statusColors = {
  [BookStatus.UNREAD]: '',
  [BookStatus.READING]: 'text-accent-600',
  [BookStatus.FINISHED]: 'text-success-600',
};

export const BookCard: React.FC<BookCardProps> = ({
  book,
  onClick,
  rank,
  size = 'medium',
}) => {
  const StatusIcon = statusIcons[book.status];
  const progress = book.userData?.progressPercentage || 0;

  // Generate a consistent color based on book title
  const coverColor = book.coverColor || generateColor(book.title);

  if (size === 'small') {
    return (
      <motion.div
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        onClick={onClick}
        className="cursor-pointer group"
      >
        <div className="relative aspect-[3/4] rounded-xl overflow-hidden shadow-sm group-hover:shadow-md transition-shadow duration-200">
          {/* Book Cover - 优先显示豆瓣封面，否则用颜色背景 */}
          {hasBookCover(book) ? (
            <img
              src={getBookCoverUrl(book)}
              alt={book.title}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                // 封面加载失败时显示色块
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent) {
                  parent.style.backgroundColor = coverColor;
                  parent.innerHTML = `
                    <div class="absolute inset-0 flex items-center justify-center p-4">
                      <div class="text-center">
                        <h4 class="text-white font-semibold text-sm line-clamp-3 drop-shadow-md">${book.title}</h4>
                        <p class="text-white/80 text-xs mt-1 line-clamp-1">${book.author}</p>
                      </div>
                    </div>
                  `;
                }
              }}
            />
          ) : book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center p-4"
              style={{ backgroundColor: coverColor }}
            >
              <div className="text-center">
                <h4 className="text-white font-semibold text-sm line-clamp-3 drop-shadow-md">
                  {book.title}
                </h4>
                <p className="text-white/80 text-xs mt-1 line-clamp-1">
                  {book.author}
                </p>
              </div>
            </div>
          )}

          {/* Progress Overlay */}
          {book.status === BookStatus.READING && progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
              <div
                className="h-full bg-white/90 rounded-r"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {/* Status Badge */}
          {StatusIcon && (
            <div className="absolute top-2 right-2">
              <div className={`w-6 h-6 rounded-full bg-white/90 flex items-center justify-center shadow-sm ${statusColors[book.status]}`}>
                <StatusIcon weight="fill" className="w-3.5 h-3.5" />
              </div>
            </div>
          )}

          {/* Rank Badge */}
          {rank && (
            <div className="absolute top-2 left-2">
              <div className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center shadow-sm text-xs font-bold text-zinc-700">
                {rank}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      onClick={onClick}
    >
      <Card hover className="h-full">
        <div className="flex gap-4">
          {/* Book Cover - 优先使用豆瓣封面 */}
          <div className="relative shrink-0">
            {hasBookCover(book) ? (
              <img
                src={getBookCoverUrl(book)}
                alt={book.title}
                className="w-20 h-28 rounded-lg shadow-sm object-cover"
                loading="lazy"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent) {
                    parent.style.backgroundColor = coverColor;
                    parent.innerHTML = `<span class="text-white font-medium text-xs text-center line-clamp-3 p-2">${book.title}</span>`;
                  }
                }}
              />
            ) : book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={book.title}
                className="w-20 h-28 rounded-lg shadow-sm object-cover"
                loading="lazy"
              />
            ) : (
              <div
                className="w-20 h-28 rounded-lg shadow-sm flex items-center justify-center p-2"
                style={{ backgroundColor: coverColor }}
              >
                <span className="text-white font-medium text-xs text-center line-clamp-3">
                  {book.title}
                </span>
              </div>
            )}
            {rank && (
              <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-accent-600 text-white text-xs font-bold flex items-center justify-center shadow-md">
                {rank}
              </div>
            )}
          </div>

          {/* Book Info */}
          <div className="flex-1 min-w-0 py-1">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-semibold text-zinc-900 line-clamp-2 text-sm leading-snug">
                {book.title}
              </h4>
              {StatusIcon && (
                <StatusIcon weight="fill" className={`w-4 h-4 shrink-0 ${statusColors[book.status]}`} />
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{book.author}</p>

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {/* 使用可视化难度组件 */}
              <DifficultyBadge level={book.level} size="sm" showLabel={false} />
              {book.rating && (
                <div className="flex items-center gap-0.5 text-amber-500">
                  <Star weight="fill" className="w-3 h-3" />
                  <span className="text-xs font-medium">{book.rating.toFixed(1)}</span>
                </div>
              )}
            </div>

            {/* 豆瓣数据信息 */}
            {book.doubanData && (
              <div className="mt-2 space-y-1">
                {/* 出版社 */}
                {book.doubanData.publisher && (
                  <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                    <Building className="w-3 h-3" />
                    <span className="line-clamp-1">{book.doubanData.publisher}</span>
                  </div>
                )}
                {/* 出版年份 + 页数 */}
                <div className="flex items-center gap-3 text-[10px] text-zinc-400">
                  {(book.doubanData.pubdate || book.doubanData.publish_year) && (
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>{book.doubanData.pubdate || book.doubanData.publish_year}</span>
                    </div>
                  )}
                  {book.doubanData.pages && (
                    <div className="flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      <span>{book.doubanData.pages}页</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Progress Bar */}
            {book.status === BookStatus.READING && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                  <span>阅读进度</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
                    className="h-full bg-accent-500 rounded-full"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
};

// Generate a consistent color from string
function generateColor(str: string): string {
  const colors = [
    '#4f46e5', // Indigo
    '#7c3aed', // Violet
    '#2563eb', // Blue
    '#0891b2', // Cyan
    '#059669', // Emerald
    '#16a34a', // Green
    '#ca8a04', // Yellow
    '#ea580c', // Orange
    '#dc2626', // Red
    '#db2777', // Pink
    '#9333ea', // Purple
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
