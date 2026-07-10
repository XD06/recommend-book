import React from 'react';
import { motion } from 'motion/react';
import { BookOpen, CheckCircle, Clock, Calendar } from '@phosphor-icons/react';
import { Book } from '../types';
import { Card } from './Card';

interface ReadingTimelineProps {
  books: Book[];
  onSelectBook: (book: Book) => void;
}

interface TimelineEvent {
  id: string;
  type: 'started' | 'finished' | 'progress';
  book: Book;
  date: Date;
  description: string;
}

export const ReadingTimeline: React.FC<ReadingTimelineProps> = ({
  books,
  onSelectBook,
}) => {
  const events = React.useMemo(() => {
    const allEvents: TimelineEvent[] = [];

    books.forEach((book) => {
      if (book.userData?.startDate) {
        allEvents.push({
          id: `${book.id}-start`,
          type: 'started',
          book,
          date: new Date(book.userData.startDate),
          description: '开始阅读',
        });
      }

      if (book.userData?.completionDate) {
        allEvents.push({
          id: `${book.id}-finish`,
          type: 'finished',
          book,
          date: new Date(book.userData.completionDate),
          description: '阅读完成',
        });
      }
    });

    // Sort by date descending
    return allEvents.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 10);
  }, [books]);

  if (events.length === 0) {
    return null;
  }

  const formatDate = (date: Date) => {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays} 天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const getEventIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'started':
        return <Clock className="w-4 h-4 text-accent-600" weight="fill" />;
      case 'finished':
        return <CheckCircle className="w-4 h-4 text-success-600" weight="fill" />;
      default:
        return <BookOpen className="w-4 h-4 text-zinc-400" />;
    }
  };

  const getEventColor = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'started':
        return 'bg-accent-100 border-accent-200';
      case 'finished':
        return 'bg-success-100 border-success-200';
      default:
        return 'bg-zinc-100 border-zinc-200';
    }
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
          {events.map((event, index) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex items-start gap-3 cursor-pointer group"
              onClick={() => onSelectBook(event.book)}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${getEventColor(
                  event.type
                )}`}
              >
                {getEventIcon(event.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-900 group-hover:text-accent-600 transition-colors line-clamp-1">
                    {event.book.title}
                  </p>
                  <span className="text-xs text-zinc-400 shrink-0">
                    {formatDate(event.date)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">{event.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </Card>
  );
};
