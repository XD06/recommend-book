import React from 'react';
import { Book, BookStatus, BookLevel } from '../types';
import { Trash, Sparkle, CircleNotch, CheckCircle, Circle } from '@phosphor-icons/react';
import { Button } from './Button';

interface LibraryTableProps {
  books: Book[];
  onDelete: (id: string) => void;
  onReorganize: () => void;
  isReorganizing: boolean;
}

const statusConfig: Record<BookStatus, { label: string; icon: React.ReactNode; color: string }> = {
  [BookStatus.UNREAD]: { label: '未读', icon: <Circle size={14} className="text-zinc-300" />, color: 'text-zinc-400' },
  [BookStatus.READING]: { label: '阅读中', icon: <CircleNotch size={14} className="text-blue-500" />, color: 'text-blue-600' },
  [BookStatus.FINISHED]: { label: '已读', icon: <CheckCircle size={14} weight="fill" className="text-accent-500" />, color: 'text-accent-700' },
};

const levelConfig: Record<BookLevel, { label: string; style: string }> = {
  [BookLevel.BASIC]: { label: '入门', style: 'bg-accent-50 text-accent-700' },
  [BookLevel.ADVANCED]: { label: '进阶', style: 'bg-blue-50 text-blue-700' },
  [BookLevel.EXPERT]: { label: '专家', style: 'bg-rose-50 text-rose-700' },
};

export const LibraryTable: React.FC<LibraryTableProps> = ({ books, onDelete, onReorganize, isReorganizing }) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 bg-zinc-50 border border-zinc-200 rounded-xl p-3">
        <p className="text-sm text-zinc-600 hidden sm:block">
          AI 可根据内容重新分配分类和子主题
        </p>
        <Button size="sm" variant="ghost" onClick={onReorganize} isLoading={isReorganizing} className="ml-auto shrink-0">
          <Sparkle size={14} /> 智能重组分类
        </Button>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-zinc-50 text-zinc-500 text-xs font-medium uppercase tracking-wide border-b border-zinc-200">
              <tr>
                <th className="px-4 py-3">书名 / 作者</th>
                <th className="px-4 py-3 hidden md:table-cell">分类</th>
                <th className="px-4 py-3">难度</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {books.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-zinc-400">暂无书籍</td></tr>
              ) : (
                books.map((book) => {
                  const st = statusConfig[book.status];
                  const lv = levelConfig[book.level];
                  return (
                    <tr key={book.id} className="hover:bg-zinc-50/50 transition-colors duration-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-900">{book.title}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{book.author}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-zinc-600">{book.category}</span>
                          <span className="text-[11px] text-zinc-400">{book.subcategory}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${lv.style}`}>{lv.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {st.icon}
                          <span className={`text-xs font-medium ${st.color}`}>{st.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => onDelete(book.id)} className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 transition-colors duration-150">
                          <Trash size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
