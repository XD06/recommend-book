import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MagnifyingGlass,
  BookOpen,
  ChartBar,
  ClockCounterClockwise,
  UserCircle,
  Sparkle,
  CheckCircle,
  Robot,
  Globe,
  ArrowSquareOut,
  PencilSimple,
} from '@phosphor-icons/react';

// ============================================================================
// 类型定义
// ============================================================================

export type AgentPhase = 'thinking' | 'generating' | null;

export interface ToolCallRecord {
  tool: string;
  label: string;
  round: number;
  status: 'running' | 'done';
}

// 工具名 → 图标映射
const TOOL_ICONS: Record<string, React.ElementType> = {
  search_library: MagnifyingGlass,
  get_book_details: BookOpen,
  get_category_stats: ChartBar,
  get_reading_history: ClockCounterClockwise,
  get_user_profile: UserCircle,
  update_book_status: PencilSimple,
  // Web 工具 — 使用 globe/外链图标
  web_search: Globe,
  web_fetch: ArrowSquareOut,
};

/** 判断是否为 Web 工具 — 用于视觉区分（蓝色系 vs 书库 accent 色） */
function isWebToolName(toolName: string): boolean {
  return toolName === 'web_search' || toolName === 'web_fetch';
}

// ============================================================================
// AgentActivity 组件 — 展示 AI 工具调用过程
// ============================================================================

interface AgentActivityProps {
  /** 当前阶段 */
  phase: AgentPhase;
  /** 工具调用记录列表 */
  toolCalls: ToolCallRecord[];
  /** 是否有流式文本正在输出 */
  hasStreamingText?: boolean;
  /** 可选的自定义提示文案 */
  thinkingLabel?: string;
  generatingLabel?: string;
  /** 紧凑模式（用于较小的容器） */
  compact?: boolean;
}

export const AgentActivity: React.FC<AgentActivityProps> = ({
  phase,
  toolCalls,
  hasStreamingText,
  thinkingLabel = '正在思考',
  generatingLabel = '正在生成回复',
  compact = false,
}) => {
  // 如果有流式文本在输出，不显示工具活动区域
  if (hasStreamingText) return null;

  // 思考阶段 — 展示工具调用列表
  if (phase === 'thinking') {
    return (
      <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
        {/* 当前阶段标题 — 带脉冲圆环动画 */}
        <div className="flex items-center gap-2 text-zinc-500">
          <div className="relative flex items-center justify-center w-5 h-5">
            <motion.div
              className="absolute inset-0 rounded-full bg-accent-200"
              animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            >
              <Sparkle size={14} className="text-accent-600 relative" weight="fill" />
            </motion.div>
          </div>
          <span className="text-xs font-medium">{thinkingLabel}</span>
        </div>

        {/* 工具调用列表 */}
        <AnimatePresence mode="popLayout">
          {toolCalls.map((tc, idx) => {
            const Icon = TOOL_ICONS[tc.tool] || Robot;
            const isRunning = tc.status === 'running';
            const isWeb = isWebToolName(tc.tool);
            return (
              <motion.div
                key={`${tc.round}-${idx}`}
                initial={{ opacity: 0, x: -12, height: 0 }}
                animate={{ opacity: 1, x: 0, height: 'auto' }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.25, delay: idx * 0.04, ease: [0.23, 1, 0.32, 1] }}
                className="flex items-center gap-2 pl-7"
              >
                {/* 图标 — 运行中带脉冲；Web 工具用蓝色系，书库工具用 accent 色 */}
                <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 relative ${
                  isRunning
                    ? isWeb
                      ? 'bg-blue-50 text-blue-600'
                      : 'bg-accent-50 text-accent-600'
                    : 'bg-success-50 text-success-600'
                }`}>
                  {isRunning && (
                    <motion.div
                      className={`absolute inset-0 rounded-md ${isWeb ? 'bg-blue-100' : 'bg-accent-100'}`}
                      animate={{ opacity: [0, 0.5, 0] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  {isRunning ? (
                    <Icon size={12} weight="bold" className="relative" />
                  ) : (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    >
                      <CheckCircle size={12} weight="fill" />
                    </motion.div>
                  )}
                </div>

                {/* 标签 */}
                <span className={`text-xs ${
                  isRunning ? 'text-zinc-700 font-medium' : 'text-zinc-400'
                }`}>
                  {tc.label}
                </span>

                {/* 运行中的动画指示器 — 三点跳动 */}
                {isRunning && (
                  <span className="flex items-center gap-0.5 ml-auto">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className={`w-1 h-1 rounded-full ${isWeb ? 'bg-blue-400' : 'bg-accent-400'}`}
                        animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{
                          duration: 0.8,
                          repeat: Infinity,
                          delay: i * 0.12,
                          ease: 'easeInOut',
                        }}
                      />
                    ))}
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* 如果还没有工具调用，显示搜索提示 */}
        {toolCalls.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 pl-7 text-zinc-400"
          >
            <motion.div
              className="w-4 h-4 border-2 border-zinc-200 border-t-accent-500 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
            />
            <span className="text-xs">正在分析请求...</span>
          </motion.div>
        )}
      </div>
    );
  }

  // 生成阶段 — 带波纹动效
  if (phase === 'generating') {
    return (
      <div className="flex items-center gap-2 text-zinc-500">
        <motion.div
          className="w-4 h-4 border-2 border-zinc-200 border-t-accent-500 rounded-full"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        />
        <span className="text-xs">{generatingLabel}</span>
      </div>
    );
  }

  // 默认 — 简洁的加载状态
  return (
    <div className="flex items-center gap-2 text-zinc-400">
      <motion.div
        className="w-4 h-4 border-2 border-zinc-200 border-t-accent-500 rounded-full"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
      />
      <span className="text-xs">等待 AI 响应...</span>
    </div>
  );
};

// ============================================================================
// useAgentActivity hook — 管理 phase 和 toolCalls 状态
// ============================================================================

import { useState, useCallback } from 'react';

export function useAgentActivity() {
  const [phase, setPhase] = useState<AgentPhase>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);

  const reset = useCallback(() => {
    setPhase(null);
    setToolCalls([]);
  }, []);

  const handlePhase = useCallback((p: 'thinking' | 'generating') => {
    setPhase(p);
    // 进入生成阶段时，将所有工具标记为已完成
    if (p === 'generating') {
      setToolCalls(prev => prev.map(tc => ({ ...tc, status: 'done' as const })));
    }
  }, []);

  const handleToolCall = useCallback((toolName: string, label: string, round: number) => {
    // 将之前的运行中工具标记为完成
    setToolCalls(prev => {
      const updated = prev.map(tc =>
        tc.status === 'running' ? { ...tc, status: 'done' as const } : tc
      );
      // 添加新的工具调用
      return [...updated, { tool: toolName, label, round, status: 'running' as const }];
    });
  }, []);

  return {
    phase,
    toolCalls,
    reset,
    handlePhase,
    handleToolCall,
  };
}
