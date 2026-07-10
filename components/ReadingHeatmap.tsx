import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Book } from '../types';
import { Card } from './Card';

interface ReadingHeatmapProps {
  books: Book[];
}

export const ReadingHeatmap: React.FC<ReadingHeatmapProps> = ({ books }) => {
  const heatmapData = useMemo(() => {
    // Generate last 12 weeks of data
    const weeks: { date: Date; count: number; intensity: number }[] = [];
    const today = new Date();

    for (let i = 83; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      weeks.push({ date, count: 0, intensity: 0 });
    }

    // Simulate reading activity based on book progress
    books.forEach((book) => {
      if (book.userData?.startDate) {
        const startDate = new Date(book.userData.startDate);
        const totalDays = Math.floor(
          (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Distribute reading activity
        for (let i = 0; i <= Math.min(totalDays, 83); i++) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dayData = weeks.find(
            (w) => w.date.toDateString() === date.toDateString()
          );
          if (dayData && Math.random() > 0.3) {
            dayData.count += 1;
            dayData.intensity = Math.min(dayData.intensity + 0.3, 1);
          }
        }
      }
    });

    // Group into weeks
    const grouped: (typeof weeks)[] = [];
    for (let i = 0; i < weeks.length; i += 7) {
      grouped.push(weeks.slice(i, i + 7));
    }

    return grouped;
  }, [books]);

  const getIntensityColor = (intensity: number) => {
    if (intensity === 0) return 'bg-zinc-100';
    if (intensity < 0.3) return 'bg-accent-200';
    if (intensity < 0.6) return 'bg-accent-300';
    if (intensity < 0.9) return 'bg-accent-400';
    return 'bg-accent-500';
  };

  const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月'];

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-zinc-100">
        <h3 className="font-semibold text-zinc-900">阅读热力图</h3>
        <p className="text-xs text-zinc-500 mt-0.5">过去 12 周的阅读活动</p>
      </div>
      <div className="p-4">
        {/* Month labels */}
        <div className="flex gap-1 mb-2">
          {monthLabels.map((month, i) => (
            <span key={i} className="text-[10px] text-zinc-400 w-8">
              {month}
            </span>
          ))}
        </div>

        {/* Heatmap grid */}
        <div className="flex gap-1">
          {heatmapData.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-1">
              {week.map((day, dayIndex) => (
                <motion.div
                  key={dayIndex}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: (weekIndex * 7 + dayIndex) * 0.002 }}
                  className={`w-3 h-3 rounded-sm ${getIntensityColor(
                    day.intensity
                  )} transition-colors hover:ring-2 hover:ring-zinc-300`}
                  title={`${day.date.toLocaleDateString('zh-CN')}: ${day.count} 本书`}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-4 justify-end">
          <span className="text-[10px] text-zinc-400">少</span>
          <div className="flex gap-0.5">
            <div className="w-3 h-3 rounded-sm bg-zinc-100" />
            <div className="w-3 h-3 rounded-sm bg-accent-200" />
            <div className="w-3 h-3 rounded-sm bg-accent-300" />
            <div className="w-3 h-3 rounded-sm bg-accent-400" />
            <div className="w-3 h-3 rounded-sm bg-accent-500" />
          </div>
          <span className="text-[10px] text-zinc-400">多</span>
        </div>
      </div>
    </Card>
  );
};
