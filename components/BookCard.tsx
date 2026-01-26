import React, { useState } from 'react';
import { Book, BookStatus, BookLevel } from '../types';
import { BookOpen, Check, Clock, TrendingUp } from 'lucide-react';

interface BookCardProps {
  book: Book;
  onClick: () => void;
}

export const BookCard: React.FC<BookCardProps> = ({ book, onClick }) => {
  const statusColor = {
    [BookStatus.UNREAD]: 'text-slate-400 bg-slate-100',
    [BookStatus.READING]: 'text-blue-600 bg-blue-50',
    [BookStatus.FINISHED]: 'text-emerald-600 bg-emerald-50',
  };

  const levelBadge = {
    [BookLevel.BASIC]: 'bg-green-100 text-green-700 border-green-200',
    [BookLevel.ADVANCED]: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    [BookLevel.EXPERT]: 'bg-red-100 text-red-800 border-red-200',
  };

  const levelText = {
    [BookLevel.BASIC]: '基础',
    [BookLevel.ADVANCED]: '进阶',
    [BookLevel.EXPERT]: '专家',
  };

  return (
    <div 
      onClick={onClick}
      className="group bg-white p-5 rounded-xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-indigo-100 hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col h-full relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 p-1">
         <div className={`w-24 h-24 bg-gradient-to-bl from-slate-50 to-transparent rounded-bl-full opacity-50 pointer-events-none group-hover:scale-110 transition-transform`} />
      </div>

      <div className="flex justify-between items-start mb-4 relative z-10">
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${levelBadge[book.level]}`}>
          {levelText[book.level]}
        </span>
        <div className={`p-1.5 rounded-full ${statusColor[book.status]} transition-colors`}>
          {book.status === BookStatus.FINISHED ? <Check size={14} /> : 
           book.status === BookStatus.READING ? <Clock size={14} /> : 
           <BookOpen size={14} />}
        </div>
      </div>
      
      <h3 className="font-bold text-slate-900 text-lg leading-snug line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors z-10">
        {book.title}
      </h3>
      <p className="text-sm text-slate-500 mb-5 font-medium z-10">{book.author}</p>
      
      <div className="mt-auto z-10">
        {book.status === BookStatus.READING && book.userData && (
          <div className="space-y-2">
             <div className="flex justify-between text-xs text-slate-500 font-medium">
               <span>当前进度</span>
               <span className="text-indigo-600">{Math.round(book.userData.progressPercentage)}%</span>
             </div>
             <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-indigo-600 h-1.5 rounded-full transition-all duration-500 ease-out" 
                  style={{ width: `${book.userData.progressPercentage}%` }}
                />
             </div>
          </div>
        )}
        
        {book.status === BookStatus.UNREAD && (
          <div className="flex items-center text-xs font-semibold text-slate-400 group-hover:text-indigo-600 transition-colors">
            <TrendingUp size={14} className="mr-1.5" />
            点击开始阅读
          </div>
        )}

        {book.status === BookStatus.FINISHED && (
          <div className="flex items-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded inline-block">
             已完成
          </div>
        )}
      </div>
    </div>
  );
};