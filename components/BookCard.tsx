import React from 'react';
import { Book, BookStatus, BookLevel } from '../types';
import { Check, Clock, Bookmark, Building2, Signal, SignalHigh, SignalMedium, BarChart2 } from 'lucide-react';

interface BookCardProps {
  book: Book;
  onClick: () => void;
  compact?: boolean; // For dense views
}

export const BookCard: React.FC<BookCardProps> = ({ book, onClick, compact = false }) => {
  
  // Define distinct styles for each level
  const levelStyles = {
    [BookLevel.BASIC]: {
      gradient: 'from-emerald-600 to-teal-900', // Green/Teal
      accent: 'bg-emerald-400',
      textAccent: 'text-emerald-100',
      label: 'BASIC',
      subLabel: '入门读物',
      bars: 1,
      watermark: 'ENTRY'
    },
    [BookLevel.ADVANCED]: {
      gradient: 'from-blue-700 to-indigo-950', // Blue/Indigo
      accent: 'bg-blue-400',
      textAccent: 'text-blue-100',
      label: 'ADVANCED',
      subLabel: '进阶研读',
      bars: 2,
      watermark: 'DEEP'
    },
    [BookLevel.EXPERT]: {
      gradient: 'from-red-900 to-slate-950', // Dark Red/Black
      accent: 'bg-rose-500',
      textAccent: 'text-rose-100',
      label: 'EXPERT',
      subLabel: '专家典藏',
      bars: 3,
      watermark: 'MASTER'
    }
  };

  const style = levelStyles[book.level];

  const statusIndicator = {
    [BookStatus.UNREAD]: { icon: Bookmark, color: 'text-white/60', bg: 'bg-black/20' },
    [BookStatus.READING]: { icon: Clock, color: 'text-white', bg: 'bg-blue-500/80 shadow-lg shadow-blue-900/50' },
    [BookStatus.FINISHED]: { icon: Check, color: 'text-white', bg: 'bg-emerald-500/80 shadow-lg shadow-emerald-900/50' },
  };

  const StatusIcon = statusIndicator[book.status].icon;

  // Render difficulty bars
  const renderBars = () => (
    <div className="flex gap-1">
      {[1, 2, 3].map((i) => (
        <div 
          key={i} 
          className={`h-1 w-3 md:h-1.5 md:w-4 rounded-full ${i <= style.bars ? style.accent : 'bg-white/10'}`} 
        />
      ))}
    </div>
  );

  return (
    <div 
      onClick={onClick}
      className={`group relative cursor-pointer perspective-1000 transition-transform duration-300 hover:-translate-y-2 w-full ${compact ? 'h-40 md:h-48' : 'h-[240px] md:h-[320px] max-w-[220px] mx-auto'}`}
    >
      {/* Book Spine Effect (Left Side) */}
      <div className="absolute left-0 top-1 bottom-1 w-2 md:w-3 bg-gradient-to-r from-white/20 to-transparent z-20 rounded-l-sm blur-[0.5px] border-l border-white/10"></div>
      
      {/* Main Cover */}
      <div className={`h-full w-full rounded-r-lg rounded-l-sm bg-gradient-to-br ${style.gradient} p-0 flex flex-col shadow-xl shadow-slate-300/50 group-hover:shadow-2xl group-hover:shadow-slate-400/50 border-r-2 border-b-2 border-black/20 relative overflow-hidden`}>
        
        {/* Texture & Lighting Overlays */}
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/leather.png')] opacity-20 pointer-events-none mix-blend-overlay"></div>
        <div className="absolute inset-0 bg-gradient-to-tr from-black/40 via-transparent to-white/10 pointer-events-none"></div>
        
        {/* Giant Watermark Text */}
        <div className="absolute -right-4 top-10 text-6xl md:text-9xl font-black text-white/5 opacity-[0.07] rotate-90 pointer-events-none font-serif tracking-tighter select-none">
          {style.watermark}
        </div>

        {/* --- Cover Content --- */}
        <div className="relative z-10 flex flex-col h-full p-3 md:p-5">
          
          {/* Top: Category Tag & Status */}
          <div className="flex justify-between items-start mb-2 md:mb-6">
            <div className="flex flex-col items-start overflow-hidden max-w-[70%]">
               <span className="text-[8px] md:text-[9px] font-bold tracking-[0.2em] uppercase text-white/90 truncate w-full">
                 {book.category}
               </span>
               {book.subcategory && (
                 <span className="text-[7px] md:text-[8px] font-medium tracking-wide uppercase text-white/60 mt-0.5 truncate w-full">
                   {book.subcategory}
                 </span>
               )}
               <div className="w-6 md:w-8 h-[1px] bg-white/20 mt-1"></div>
            </div>
            
            <div className={`p-1 md:p-1.5 rounded-full backdrop-blur-md transition-all shrink-0 ${statusIndicator[book.status].bg} ${statusIndicator[book.status].color}`}>
               <StatusIcon size={12} className="md:w-[14px] md:h-[14px]" strokeWidth={3} />
            </div>
          </div>

          {/* Center: Title & Author */}
          <div className="my-auto">
            <h3 className={`font-serif text-white font-bold leading-tight drop-shadow-md line-clamp-3 ${compact ? 'text-xs md:text-sm' : 'text-sm md:text-xl'}`}>
              {book.title}
            </h3>
            <div className={`w-6 md:w-8 h-1 ${style.accent} mt-2 md:mt-3 mb-1 md:mb-2 rounded-full`}></div>
            <p className="text-white/80 text-[10px] md:text-xs font-medium tracking-wide line-clamp-1">
              {book.author}
            </p>
          </div>

          {/* Bottom: Publisher & Level Indicator */}
          <div className="mt-auto pt-2 md:pt-4 border-t border-white/10">
            {book.status === BookStatus.READING && book.userData ? (
              <div className="space-y-1 md:space-y-2">
                <div className="flex justify-between text-[8px] md:text-[10px] text-white/70 font-medium">
                   <span>进度</span>
                   <span>{Math.round(book.userData.progressPercentage)}%</span>
                </div>
                <div className="w-full bg-black/30 h-1 md:h-1.5 rounded-full overflow-hidden">
                   <div className={`${style.accent} h-full transition-all duration-500`} style={{ width: `${book.userData.progressPercentage}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1 md:gap-2">
                 <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className={`text-[8px] md:text-[10px] font-bold uppercase tracking-wider ${style.textAccent}`}>
                        {style.label}
                      </span>
                    </div>
                    {renderBars()}
                 </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3D Paper Pages Effect */}
      <div className="absolute top-[4px] bottom-[4px] right-[0px] w-2 md:w-3 bg-[#f5f5f0] border-l border-slate-200 transform translate-x-1 md:translate-x-2 -translate-z-4 z-[-1] rounded-r-[2px] shadow-sm flex flex-col justify-end overflow-hidden">
        <div className="w-full h-px bg-slate-200 my-[1px]"></div>
        <div className="w-full h-px bg-slate-200 my-[1px]"></div>
        <div className="w-full h-px bg-slate-200 my-[1px]"></div>
      </div>
    </div>
  );
};