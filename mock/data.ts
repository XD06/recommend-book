/**
 * Mock 数据 - 用于开发和演示
 * 
 * 注意：这些数据仅用于前端开发测试，
 * 正式使用时会被 LocalStorage 中的真实数据覆盖
 */

import { Book, BookStatus, BookLevel } from '../types';

// 封面颜色池
const coverColors = [
  '#059669', '#2563eb', '#dc2626', '#7c3aed', '#d97706',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
];

// 获取一致的颜色
function getColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return coverColors[Math.abs(hash) % coverColors.length];
}

// 示例书籍数据（用于演示）
export const sampleBooks: Book[] = [
  {
    id: 'sample-1',
    title: '示例书籍 - 代码大全',
    author: 'Steve McConnell',
    publisher: '电子工业出版社',
    category: '计算机科学',
    subcategory: '软件工程',
    level: BookLevel.ADVANCED,
    status: BookStatus.READING,
    coverColor: getColor('代码大全'),
    rating: 9.3,
    userData: { 
      totalPages: 936, 
      currentPage: 287, 
      progressPercentage: 30.7, 
      startDate: '2025-06-15' 
    },
    aiInsight: {
      summary: '《代码大全》是软件构建领域的经典著作，全面涵盖了从需求分析到代码优化的软件构建过程。',
      advice: '建议先阅读第 1-4 章建立软件构建的全局视野。',
      keyChapters: ['第7章: 高质量的子程序', '第12章: 基本数据类型'],
    },
  },
];

// 空书库 - 用于正式环境初始化
export const emptyLibrary: Book[] = [];

// 检查是否是首次使用
export function isFirstTimeUser(): boolean {
  if (typeof window === 'undefined') return false;
  return !window.localStorage.getItem('deepread_library');
}

// 获取初始书籍数据
export function getInitialBooks(): Book[] {
  return emptyLibrary;
}

// 导出兼容旧代码的 mockBooks（现在返回空数组）
export const mockBooks = emptyLibrary;
