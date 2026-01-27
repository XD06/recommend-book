import React from 'react';
import { Book, BookStatus, BookLevel } from '../types';
import { Trash2, Edit2, CheckCircle2, Circle, Wand2, Signal, SignalMedium, SignalHigh } from 'lucide-react';
import { Button } from './Button';

interface LibraryTableProps {
  books: Book[];
  onDelete: (id: string) => void;
  onReorganize: () => void;
  isReorganizing: boolean;
}

export const LibraryTable: React.FC<LibraryTableProps> = ({ books, onDelete, onReorganize, isReorganizing }) => {
  const statusLabels = {
    [BookStatus.UNREAD]: '未读',
    [BookStatus.READING]: '阅读中',
    [BookStatus.FINISHED]: '已读',
  };

  const levelConfig = {
    [BookLevel.BASIC]: {
      label: '基础',
      style: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      icon: <SignalMedium size={14} className="mr-1" />
    },
    [BookLevel.ADVANCED]: {
      label: '进阶',
      style: 'bg-blue-50 text-blue-700 border border-blue-200',
      icon: <SignalHigh size={14} className="mr-1" />
    },
    [BookLevel.EXPERT]: {
      label: '专家',
      style: 'bg-slate-50 text-rose-700 border border-rose-200 font-bold',
      icon: <Signal size={14} className="mr-1" />
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 items-center">
         <div className="mr-auto text-sm text-indigo-800">
           <span className="font-bold">💡 智能整理：</span> 觉得分类太乱？让 AI 帮您重新规划，自动合并相似领域。
         </div>
         <Button 
           size="sm" 
           variant="secondary" 
           onClick={onReorganize} 
           isLoading={isReorganizing}
           className="shadow-sm"
         >
           <Wand2 size={16} className="mr-2" /> 智能重组分类
         </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
              <tr>
                <th className="px-6 py-4">书名 / 作者</th>
                <th className="px-6 py-4">分类</th>
                <th className="px-6 py-4">难度评级</th>
                <th className="px-6 py-4">状态</th>
                <th className="px-6 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {books.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                    暂无书籍数据
                  </td>
                </tr>
              ) : (
                books.map((book) => (
                  <tr key={book.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900 font-serif text-base">{book.title}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{book.author}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      <span className="inline-block px-2.5 py-1 bg-slate-100 rounded-md text-xs font-medium border border-slate-200">
                        {book.category}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${levelConfig[book.level].style}`}>
                        {levelConfig[book.level].icon}
                        {levelConfig[book.level].label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                         {book.status === BookStatus.FINISHED ? (
                           <CheckCircle2 size={16} className="text-emerald-500" />
                         ) : book.status === BookStatus.READING ? (
                           <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                         ) : (
                           <Circle size={16} className="text-slate-300" />
                         )}
                         <span className={
                           book.status === BookStatus.FINISHED ? 'text-emerald-700 font-medium' :
                           book.status === BookStatus.READING ? 'text-blue-700 font-medium' : 'text-slate-400'
                         }>
                           {statusLabels[book.status]}
                         </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => onDelete(book.id)}
                        className="text-slate-400 hover:text-red-600 transition-colors p-2 hover:bg-red-50 rounded-lg"
                        title="删除"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};