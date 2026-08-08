import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * useAIStreaming — 统一管理 AI 流式请求的辅助状态
 *
 * 提供：
 * - reasoningText: AI 思考过程文本
 * - elapsedTime: 已用时间（秒）
 * - onReasoning: 传给后端流式 API 的回调
 * - startTimer / stopTimer: 计时器管理
 * - reset: 全部重置
 */
export function useAIStreaming() {
  const [reasoningText, setReasoningText] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onReasoning = useCallback((chunk: string) => {
    setReasoningText(prev => prev + chunk);
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

  const resetReasoning = useCallback(() => {
    setReasoningText('');
  }, []);

  const reset = useCallback(() => {
    setReasoningText('');
    setElapsedTime(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
    reasoningText,
    elapsedTime,
    onReasoning,
    startTimer,
    stopTimer,
    resetReasoning,
    reset,
  };
}
