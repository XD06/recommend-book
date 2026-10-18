import React from 'react';
import { motion } from 'motion/react';
import { BookOpen, CheckCircle, Clock, Calendar, PlusCircle, Trash } from '@phosphor-icons/react';
import { Book, BookActivity, ActivityType } from '../types';
import { Card } from './Card';

interface ReadingTimelineProps {
  /** 动态流水（来自后端 book_activities） */
  activities: BookActivity[];
  /** 用于把动态里的 bookId 映射回书对象，点进去看详情 */
  books: Book[];
  onSelectBook: (book: Book) => void;
  loading?: boolean;
}

/** 每种动态的展示信息 */
const EVENT_META: Record<
  ActivityType,
  { label: string; icon: React.ElementType; iconClass: string; ringClass: string }
> = {
  added: {
    label: '新增到书库',
    icon: PlusCircle,
    iconClass: 'text-indigo-600',
    ringClass: 'bg-indigo-100 border-indigo-200',
  },
  started: {
    label: '开始阅读',
    icon: Clock,
    iconClass: 'text-accent-600',
    ringClass: 'bg-accent-100 border-accent-200',
  },
  finished: {
    label: '阅读完成',
    icon: CheckCircle,
    iconClass: 'text-success-600',
    ringClass: 'bg-success-100 border-success-200',
  },
  deleted: {
    label: '移出书库',
    icon: Trash,
    iconClass: 'text-zinc-500',
    ringClass: 'bg-zinc-100 border-zinc-200',
  },
};

export const ReadingTimeline: React.FC<ReadingTimelineProps> = ({
  activities,
  books,
  onSelectBook,
  loading = false,
}) => {
  const bookById = React.useMemo(() => {
    const map = new Map<string, Book>();
    for (const b of books) map.set(b.id, b);
    return map;
  }, [books]);

  if (loading) {
    return (
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-zinc-100">
          <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-zinc-400" />
            阅读动态
          </h3>
        </div>
        <div className="p-4 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-zinc-100 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-zinc-100 rounded w-2/3" />
                <div className="h-2.5 bg-zinc-50 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (activities.length === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-zinc-100">
          <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-zinc-400" />
            阅读动态
          </h3>
        </div>
        <div className="p-6 text-center">
          <div className="w-10 h-10 rounded-xl bg-zinc-50 flex items-center justify-center mx-auto mb-2">
            <BookOpen className="w-5 h-5 text-zinc-300" />
          </div>
          <p className="text-xs text-zinc-400">还没有动态，添加或开始读一本书试试</p>
        </div>
      </Card>
    );
  }

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    // 按自然日比较，避免"今天 00:10"因为不足 24 小时被算成昨天
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);

    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays} 天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;

    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-zinc-100">
        <h3 className="font-semibold text-zinc-900 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-zinc-400" />
          阅读动态
        </h3>
      </div>
      <div className="p-4">
        <div className="space-y-4">
          {activities.map((activity, index) => {
            const meta = EVENT_META[activity.type] ?? EVENT_META.added;
            const Icon = meta.icon;
            // 已删除的书在 books 里找不到 → 不可点，避免点开一个不存在的详情页
            const book = activity.bookId ? bookById.get(activity.bookId) : undefined;
            const clickable = !!book;

            return (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.06 }}
                className={`flex items-start gap-3 group ${clickable ? 'cursor-pointer' : ''}`}
                onClick={() => book && onSelectBook(book)}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${meta.ringClass}`}
                >
                  <Icon className={`w-4 h-4 ${meta.iconClass}`} weight="fill" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`text-sm font-medium text-zinc-900 line-clamp-1 transition-colors ${
                        clickable ? 'group-hover:text-accent-600' : ''
                      }`}
                    >
                      {activity.bookTitle}
                    </p>
                    <span className="text-xs text-zinc-400 shrink-0">
                      {formatDate(activity.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">{meta.label}</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};
