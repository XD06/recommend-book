import React from 'react';
import { motion } from 'motion/react';
import { BookLevel } from '../types';
import { Plant, Tree, Mountains } from '@phosphor-icons/react';

interface DifficultyBadgeProps {
  level: BookLevel;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

const config = {
  [BookLevel.BASIC]: {
    icon: Plant,
    label: '入门',
    shortLabel: '入门',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    barColor: 'bg-emerald-500',
    description: '适合初学者',
    bars: 1,
  },
  [BookLevel.ADVANCED]: {
    icon: Tree,
    label: '进阶',
    shortLabel: '进阶',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    barColor: 'bg-amber-500',
    description: '需要一定基础',
    bars: 2,
  },
  [BookLevel.EXPERT]: {
    icon: Mountains,
    label: '专家',
    shortLabel: '专家',
    color: 'text-rose-600',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
    barColor: 'bg-rose-500',
    description: '深度专业内容',
    bars: 3,
  },
};

const sizeClasses = {
  sm: {
    container: 'px-2 py-0.5 gap-1',
    icon: 'w-3 h-3',
    text: 'text-xs',
    bar: 'w-1 h-2',
    barGap: 'gap-0.5',
  },
  md: {
    container: 'px-2.5 py-1 gap-1.5',
    icon: 'w-4 h-4',
    text: 'text-sm',
    bar: 'w-1.5 h-3',
    barGap: 'gap-1',
  },
  lg: {
    container: 'px-3 py-1.5 gap-2',
    icon: 'w-5 h-5',
    text: 'text-base',
    bar: 'w-2 h-4',
    barGap: 'gap-1',
  },
};

export const DifficultyBadge: React.FC<DifficultyBadgeProps> = ({
  level,
  showLabel = true,
  size = 'md',
  animated = false,
}) => {
  const cfg = config[level];
  const Icon = cfg.icon;
  const sizes = sizeClasses[size];

  const content = (
    <div
      className={[
        'inline-flex items-center rounded-lg border transition-colors duration-200',
        cfg.bgColor,
        cfg.borderColor,
        sizes.container,
      ].join(' ')}
    >
      {/* 图标 */}
      <Icon className={[cfg.color, sizes.icon].join(' ')} weight="fill" />

      {/* 文字标签 */}
      {showLabel && (
        <span className={[cfg.color, sizes.text, 'font-medium'].join(' ')}>
          {cfg.label}
        </span>
      )}

      {/* 难度条可视化 */}
      <div className={['flex items-end', sizes.barGap, 'ml-1'].join(' ')}>
        {[1, 2, 3].map((bar) => (
          <motion.div
            key={bar}
            initial={animated ? { scaleY: 0 } : false}
            animate={{ scaleY: 1 }}
            transition={
              animated
                ? {
                    delay: bar * 0.1,
                    duration: 0.3,
                    ease: [0.23, 1, 0.32, 1],
                  }
                : undefined
            }
            className={[
              sizes.bar,
              'rounded-full origin-bottom',
              bar <= cfg.bars ? cfg.barColor : 'bg-zinc-200',
            ].join(' ')}
          />
        ))}
      </div>
    </div>
  );

  if (animated) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      >
        {content}
      </motion.div>
    );
  }

  return content;
};

// 难度对比条组件 - 用于展示三个级别对比
export const DifficultyScale: React.FC<{
  currentLevel: BookLevel;
  className?: string;
}> = ({ currentLevel, className = '' }) => {
  const levels = [BookLevel.BASIC, BookLevel.ADVANCED, BookLevel.EXPERT];

  return (
    <div className={['space-y-2', className].join(' ')}>
      {levels.map((level) => {
        const cfg = config[level];
        const Icon = cfg.icon;
        const isActive = level === currentLevel;

        return (
          <motion.div
            key={level}
            className={[
              'flex items-center gap-3 p-2 rounded-lg transition-colors',
              isActive ? cfg.bgColor : 'bg-transparent',
            ].join(' ')}
            whileHover={{ x: isActive ? 0 : 4 }}
          >
            <Icon
              className={[cfg.color, 'w-5 h-5', isActive ? 'opacity-100' : 'opacity-40'].join(' ')}
              weight={isActive ? 'fill' : 'regular'}
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span
                  className={[
                    'text-sm font-medium',
                    isActive ? cfg.color : 'text-zinc-400',
                  ].join(' ')}
                >
                  {cfg.label}
                </span>
                <div className="flex gap-0.5">
                  {[1, 2, 3].map((bar) => (
                    <div
                      key={bar}
                      className={[
                        'w-1.5 h-3 rounded-full',
                        bar <= cfg.bars
                          ? isActive
                            ? cfg.barColor
                            : 'bg-zinc-300'
                          : 'bg-zinc-200',
                      ].join(' ')}
                    />
                  ))}
                </div>
              </div>
              <p className={['text-xs mt-0.5', isActive ? 'text-zinc-600' : 'text-zinc-400'].join(' ')}>
                {cfg.description}
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default DifficultyBadge;
