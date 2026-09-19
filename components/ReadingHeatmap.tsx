import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Book } from '../types';
import { Card } from './Card';

interface ReadingHeatmapProps {
  books: Book[];
}

/** 本地日期键：'YYYY-MM-DD' 直接取字面量，完整时间戳按本地时区取日 */
function dayKey(iso: string | undefined): string | null {
  if (!iso) return null;
  const literal = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (literal) return `${+literal[1]}-${+literal[2]}-${+literal[3]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 每周一列，列首月份变化时才打标签 */
function buildMonthLabels(days: { date: Date }[]): string[] {
  const labels: string[] = [];
  let lastMonth = -1;
  for (let i = 0; i < days.length; i += 7) {
    const month = days[i].date.getMonth();
    labels.push(month === lastMonth ? '' : `${month + 1}月`);
    lastMonth = month;
  }
  return labels;
}

export const ReadingHeatmap: React.FC<ReadingHeatmapProps> = ({ books }) => {
  const heatmapData = useMemo(() => {
    // 只统计真实记录过的事件：开始阅读日（startDate）与读完日（completionDate）。
    // 没有阅读行为流水表，所以不再按进度随机模拟每日活动。
    const today = new Date();
    const days: { date: Date; count: number }[] = [];
    const indexByKey = new Map<string, number>();
    for (let i = 83; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      indexByKey.set(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`, days.length);
      days.push({ date, count: 0 });
    }

    books.forEach((book) => {
      for (const iso of [book.userData?.startDate, book.userData?.completionDate]) {
        const key = dayKey(iso);
        const idx = key === null ? undefined : indexByKey.get(key);
        if (idx !== undefined) days[idx].count += 1;
      }
    });

    const maxCount = Math.max(0, ...days.map((d) => d.count));
    const cells = days.map((d) => ({
      ...d,
      intensity: d.count === 0 || maxCount === 0 ? 0 : Math.min(1, d.count / maxCount),
    }));

    const grouped: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      grouped.push(cells.slice(i, i + 7));
    }

    return {
      grouped,
      monthLabels: buildMonthLabels(days),
      eventCount: days.reduce((sum, d) => sum + d.count, 0),
    };
  }, [books]);

  const getIntensityColor = (intensity: number) => {
    if (intensity === 0) return 'bg-zinc-100';
    if (intensity < 0.3) return 'bg-accent-200';
    if (intensity < 0.6) return 'bg-accent-300';
    if (intensity < 0.9) return 'bg-accent-400';
    return 'bg-accent-500';
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-zinc-100">
        <h3 className="font-semibold text-zinc-900">阅读热力图</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          过去 12 周 · 记录到 {heatmapData.eventCount} 次「开始阅读 / 读完」
        </p>
      </div>
      <div className="p-4">
        {/* Month labels */}
        <div className="flex gap-1 mb-2">
          {heatmapData.monthLabels.map((month, i) => (
            <span key={i} className="text-[10px] text-zinc-400 w-8">
              {month}
            </span>
          ))}
        </div>

        {/* Heatmap grid */}
        <div className="flex gap-1">
          {heatmapData.grouped.map((week, weekIndex) => (
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
                  title={`${day.date.toLocaleDateString('zh-CN')}: 开始/读完 ${day.count} 本`}
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
