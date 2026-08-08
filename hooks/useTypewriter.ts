import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * 打字机 hook — 将流式到达的文本逐字渲染
 *
 * 核心设计：
 * - 使用 requestAnimationFrame 对齐浏览器刷新帧，避免过度渲染
 * - 只在 displayedLen 实际增长时才 setState，减少无意义重渲染
 * - 自适应速度：缓冲区小时慢速逐字（打字机效果），缓冲区大时加速追赶
 * - finish() 不再瞬间 dump，而是加速到最大速度尽快完成
 * - 渲染速度永远不会超过 chunk 到达速度（不会"超跑"流式数据）
 *
 * @param baseSpeed 基础速度（每帧推进的字符数），默认 1
 * @returns { displayedText, append, reset, isTyping, finish }
 */
export function useTypewriter(baseSpeed: number = 1) {
  const [displayedText, setDisplayedText] = useState('');
  const fullTextRef = useRef('');
  const displayedLenRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const finishingRef = useRef(false);

  // 逐字推进（在 rAF 回调中执行）
  const tick = useCallback(() => {
    const full = fullTextRef.current;
    const currentLen = displayedLenRef.current;

    if (currentLen >= full.length) {
      // 已全部显示，停止定时器
      rafRef.current = null;
      finishingRef.current = false;
      return;
    }

    // 自适应速度：
    // - 缓冲区（未显示的文本）<= 20 字符：用基础速度（打字机效果）
    // - 缓冲区 > 20 字符：按比例加速，最多 16x 基础速度
    // - finish() 模式：使用最大速度
    const buffer = full.length - currentLen;
    let speed: number;
    if (finishingRef.current) {
      // finish 模式：快速但不瞬间，每帧 32 字符
      speed = Math.min(buffer, 32);
    } else if (buffer <= 20) {
      speed = baseSpeed;
    } else {
      // 缓冲区越大，速度越快（对数增长，避免过快）
      speed = Math.min(baseSpeed * Math.ceil(buffer / 20), baseSpeed * 16);
    }

    const nextLen = Math.min(currentLen + speed, full.length);
    displayedLenRef.current = nextLen;
    // 只在内容实际变化时才触发 setState
    setDisplayedText(full.slice(0, nextLen));

    // 继续下一帧
    rafRef.current = requestAnimationFrame(tick);
  }, [baseSpeed]);

  // 启动 rAF 循环
  const ensureRunning = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  // 追加文本
  const append = useCallback((chunk: string) => {
    if (!chunk) return;
    fullTextRef.current += chunk;
    ensureRunning();
  }, [ensureRunning]);

  // 重置
  const reset = useCallback(() => {
    fullTextRef.current = '';
    displayedLenRef.current = 0;
    finishingRef.current = false;
    setDisplayedText('');
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // 加速完成 — 不再瞬间 dump，而是快速逐字完成
  // 这样在最后几秒仍保持打字机视觉效果，只是速度加快
  const finish = useCallback(() => {
    finishingRef.current = true;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  // 清理
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return {
    displayedText,
    append,
    reset,
    finish,
    isTyping: displayedLenRef.current < fullTextRef.current.length,
  };
}
