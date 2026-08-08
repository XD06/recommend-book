import { useState, useEffect } from 'react';

/**
 * useDebounce — 延迟更新值
 *
 * 适用于搜索框输入防抖，避免每次按键都触发过滤计算。
 *
 * @param value 原始值
 * @param delay 延迟毫秒数，默认 200ms
 * @returns 防抖后的值
 */
export function useDebounce<T>(value: T, delay: number = 200): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
