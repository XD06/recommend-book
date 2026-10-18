import { useCallback, useEffect, useRef, useState } from 'react';
import { BookActivity } from '../types';
import { fetchActivities } from '../services/bookService';

/**
 * 拉取阅读动态（书库操作流水）。
 *
 * 为什么单独一个 hook：LibraryView 与 StatsView 都要显示同一份动态，
 * 而它的数据源不在 books 里（后端 book_activities 表），需要自己发请求。
 *
 * `refreshKey` 变化时重新拉：书库增删改之后由上层 bump 一次，
 * 让"新增/删除"立刻出现在动态里，不用等下次刷新页面。
 */
export function useActivities(refreshKey: unknown = null, limit = 12) {
  const [activities, setActivities] = useState<BookActivity[]>([]);
  const [loading, setLoading] = useState(true);
  // 卸载后不再 setState：切 tab 会重挂载，迟到的响应会打到已卸载组件上
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await fetchActivities(limit);
      if (aliveRef.current) setActivities(data);
    } catch {
      // 动态是附属信息，拉不到就保持空列表，不要弹错误打扰用户
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return { activities, loading, reload: load };
}
