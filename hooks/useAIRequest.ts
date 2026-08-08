/**
 * useAIRequest — 统一 AI 请求状态管理 Hook
 *
 * 合并了 useAIStreaming + useTypewriter 的核心能力，并增加：
 * - loading / error / phase 统一管理
 * - agentActivities（工具调用记录）
 * - bookUpdates（AI 写操作产生的书籍更新）
 * - abort 控制
 * - 请求去重（同一请求不重复发起）
 *
 * 用法：
 * const ai = useAIRequest();
 * ai.start(() => getPersonalizedRecommendationsStream(...ai.callbacks));
 * ai.abort();
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export type AIPhase = 'idle' | 'thinking' | 'generating' | 'done' | 'error';

export interface AgentActivity {
  id: string;
  toolName: string;
  label: string;
  round: number;
  timestamp: number;
}

export interface BookUpdateEvent {
  bookId: string;
  updates: any;
  timestamp: number;
}

export function useAIRequest() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<AIPhase>('idle');
  const [streamingText, setStreamingText] = useState('');
  const [reasoningText, setReasoningText] = useState('');
  const [agentActivities, setAgentActivities] = useState<AgentActivity[]>([]);
  const [bookUpdates, setBookUpdates] = useState<BookUpdateEvent[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- 计时器 ----
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

  // ---- 回调集合（传给流式 API）----
  const onChunk = useCallback((chunk: string) => {
    setStreamingText(prev => prev + chunk);
  }, []);

  const onPhase = useCallback((p: 'thinking' | 'generating') => {
    setPhase(p);
  }, []);

  const onReasoning = useCallback((chunk: string) => {
    setReasoningText(prev => prev + chunk);
  }, []);

  const onToolCall = useCallback((toolName: string, label: string, round: number) => {
    setAgentActivities(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolName,
        label,
        round,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const onBookUpdate = useCallback((bookId: string, updates: any) => {
    setBookUpdates(prev => [
      ...prev,
      { bookId, updates, timestamp: Date.now() },
    ]);
  }, []);

  // ---- 控制 ----
  const start = useCallback(async (fn: (signal: AbortSignal) => Promise<any>) => {
    // 防止重复请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);
    setPhase('thinking');
    setStreamingText('');
    setReasoningText('');
    setAgentActivities([]);
    setBookUpdates([]);
    startTimer();

    try {
      const result = await fn(controller.signal);
      setPhase('done');
      stopTimer();
      return result;
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // 用户主动取消，不设 error
        setPhase('idle');
      } else {
        setError(e?.message || '请求失败');
        setPhase('error');
      }
      stopTimer();
      throw e;
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [startTimer, stopTimer]);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setPhase('idle');
    stopTimer();
  }, [stopTimer]);

  const reset = useCallback(() => {
    setStreamingText('');
    setReasoningText('');
    setAgentActivities([]);
    setBookUpdates([]);
    setError(null);
    setPhase('idle');
    setElapsedTime(0);
    stopTimer();
  }, [stopTimer]);

  const resetReasoning = useCallback(() => {
    setReasoningText('');
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return {
    // 状态
    isLoading,
    error,
    phase,
    streamingText,
    reasoningText,
    agentActivities,
    bookUpdates,
    elapsedTime,
    // 回调（传给 API）
    callbacks: {
      onChunk,
      onPhase,
      onReasoning,
      onToolCall,
      onBookUpdate,
    },
    // 控制
    start,
    abort,
    reset,
    resetReasoning,
    startTimer,
    stopTimer,
  };
}
