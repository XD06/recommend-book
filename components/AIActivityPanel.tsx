import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkle,
  CheckCircle,
  Robot,
  Globe,
  ArrowSquareOut,
  MagnifyingGlass,
  BookOpen,
  ChartBar,
  ClockCounterClockwise,
  UserCircle,
  PencilSimple,
  Brain,
  StopCircle,
  PaperPlaneTilt,
  Lightbulb,
} from '@phosphor-icons/react';

// ============================================================================
// 类型定义
// ============================================================================

export type AgentPhase = 'sending' | 'thinking' | 'generating' | null;

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
  get_reading_taste_profile: Sparkle,
  get_reading_gaps: Lightbulb,
  web_search: Globe,
  web_fetch: ArrowSquareOut,
};

function isWebToolName(toolName: string): boolean {
  return toolName === 'web_search' || toolName === 'web_fetch';
}

// ============================================================================
// AIActivityPanel — 完全透明的 AI 流程展示
// ============================================================================

interface AIActivityPanelProps {
  phase: AgentPhase;
  toolCalls: ToolCallRecord[];
  reasoningText: string;
  elapsedTime: number;
  receivedChars: number;
  onCancel: () => void;
  thinkingLabel?: string;
  generatingLabel?: string;
  compact?: boolean;
}

export const AIActivityPanel: React.FC<AIActivityPanelProps> = ({
  phase,
  toolCalls,
  reasoningText,
  elapsedTime,
  receivedChars,
  onCancel,
  thinkingLabel = '正在分析你的书库',
  generatingLabel = '正在生成推荐结果',
  compact = false,
}) => {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {/* 阶段指示器 */}
      <div className="flex items-center gap-2 text-zinc-600">
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
        <span className="text-xs font-medium">
          {phase === 'sending' && '请求已发送，等待 AI 响应...'}
          {phase === 'thinking' && thinkingLabel}
          {phase === 'generating' && generatingLabel}
          {!phase && '等待 AI 响应...'}
        </span>
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
              <span className={`text-xs ${isRunning ? 'text-zinc-700 font-medium' : 'text-zinc-400'}`}>
                {tc.label}
              </span>
              {isRunning && (
                <span className="flex items-center gap-0.5 ml-auto">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className={`w-1 h-1 rounded-full ${isWeb ? 'bg-blue-400' : 'bg-accent-400'}`}
                      animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
                    />
                  ))}
                </span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* 生成阶段进度 */}
      {phase === 'generating' && receivedChars > 0 && (
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
          <span className="text-xs">正在生成回复 · 已接收 {receivedChars} 字符</span>
        </motion.div>
      )}

      {/* 生成阶段 — 推理内容可折叠查看 */}
      {phase === 'generating' && reasoningText && (
        <details className="group ml-7 mr-2 rounded-lg bg-white/50 p-2">
          <summary className="flex items-center gap-1.5 cursor-pointer text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors select-none">
            <Brain size={10} weight="fill" />
            <span>查看思考过程（{reasoningText.length} 字）</span>
          </summary>
          <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
            {reasoningText.slice(-500)}
          </p>
        </details>
      )}

      {/* 思考阶段 — 无工具调用时的明显动画 */}
      {phase === 'thinking' && toolCalls.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2.5 pl-7"
        >
          {/* 三个弹跳点 */}
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="w-2 h-2 rounded-full bg-accent-400"
                animate={{ y: [0, -6, 0], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
              />
            ))}
          </div>
          <span className="text-xs text-zinc-500 font-medium">
            {elapsedTime > 10 ? '正在深度思考…' : elapsedTime > 5 ? '正在分析你的书库…' : '正在理解你的需求…'}
          </span>
        </motion.div>
      )}

      {/* 思考阶段 — 有推理内容时显示摘要 */}
      {phase === 'thinking' && reasoningText && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="ml-7 mr-2 rounded-lg bg-white/70 border border-zinc-200/50 p-2.5"
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Brain size={11} className="text-accent-500" weight="fill" />
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">AI 思考中</span>
            <motion.span
              className="ml-auto text-[10px] text-zinc-400"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              {reasoningText.length} 字
            </motion.span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap break-words line-clamp-3">
            {reasoningText.slice(-300)}
          </p>
        </motion.div>
      )}

      {/* 计时 + 取消 */}
      <div className="flex items-center justify-between pt-1">
        {elapsedTime > 0 && (
          <span className="text-[11px] text-zinc-400 tabular-nums">
            已用时 {elapsedTime}s
          </span>
        )}
        <button
          onClick={onCancel}
          className={`px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-rose-600 hover:bg-rose-50 active:scale-95 transition-all flex items-center gap-1 ${elapsedTime > 0 ? '' : 'ml-auto'}`}
        >
          <StopCircle size={12} />
          取消
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// useAIActivity hook — 统一管理 AI 活动状态
// ============================================================================

export function useAIActivity() {
  const [phase, setPhase] = useState<AgentPhase>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[]>([]);
  const [reasoningText, setReasoningText] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [receivedChars, setReceivedChars] = useState(0);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    setPhase(null);
    setToolCalls([]);
    setReasoningText('');
    setElapsedTime(0);
    setReceivedChars(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsedTime(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePhase = useCallback((p: 'thinking' | 'generating') => {
    setPhase(p);
    if (p === 'generating') {
      setToolCalls(prev => prev.map(tc => ({ ...tc, status: 'done' as const })));
    }
  }, []);

  const handleToolCall = useCallback((toolName: string, label: string, round: number) => {
    setToolCalls(prev => {
      const updated = prev.map(tc =>
        tc.status === 'running' ? { ...tc, status: 'done' as const } : tc
      );
      return [...updated, { tool: toolName, label, round, status: 'running' as const }];
    });
  }, []);

  const handleReasoning = useCallback((chunk: string) => {
    setReasoningText(prev => prev + chunk);
  }, []);

  const handleChunk = useCallback((chunk: string) => {
    setReceivedChars(prev => prev + chunk.length);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return {
    phase,
    toolCalls,
    reasoningText,
    elapsedTime,
    receivedChars,
    reset,
    startTimer,
    stopTimer,
    handlePhase,
    handleToolCall,
    handleReasoning,
    handleChunk,
  };
}
