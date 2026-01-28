import React, { useState, useRef, useEffect } from 'react';
import { Book, AdvisorResponse, Recommendation } from '../types';
import { Button } from './Button';
import { getPersonalizedRecommendations } from '../services/geminiService';
import { Sparkles, Send, Library, Search, Plus, BookOpen, Bot, Quote, ArrowRight } from 'lucide-react';

interface AIAdvisorProps {
  books: Book[];
  onSelectBook: (book: Book) => void;
  onAddBook: (rec: Recommendation) => void;
}

export const AIAdvisor: React.FC<AIAdvisorProps> = ({ books, onSelectBook, onAddBook }) => {
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdvisorResponse | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const handleConsult = async () => {
    if (!request.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const response = await getPersonalizedRecommendations(request, books);
      setResult(response);
    } catch (e) {
      alert("AI 顾问暂时繁忙，请稍后再试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  const getLibraryBook = (id: string) => books.find(b => b.id === id);

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] max-w-6xl mx-auto px-4 md:px-8">
      
      {/* 1. Header & Input Section - Moves to top/compact when result exists */}
      <div className={`transition-all duration-700 ease-in-out flex flex-col items-center justify-center ${result ? 'py-6 min-h-[auto]' : 'flex-1 min-h-[50vh]'}`}>
        
        {/* Logo/Title */}
        <div className={`text-center transition-all duration-500 ${result ? 'mb-6 flex items-center gap-4' : 'mb-10'}`}>
          <div className={`bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 transition-all duration-500 ${result ? 'w-10 h-10' : 'w-16 h-16 mx-auto mb-6'}`}>
            <Sparkles size={result ? 20 : 32} />
          </div>
          <div className={result ? 'text-left' : ''}>
             <h2 className={`font-serif font-bold text-slate-900 transition-all ${result ? 'text-xl' : 'text-3xl mb-3'}`}>
               {result ? 'AI 阅读顾问' : '有什么我可以帮您的吗？'}
             </h2>
             {!result && (
               <p className="text-slate-500 max-w-lg mx-auto leading-relaxed">
                 告诉我您的目标（如“想成为技术管理者”）、困惑（如“最近很焦虑”）或兴趣。
               </p>
             )}
          </div>
        </div>

        {/* Input Box */}
        <div className={`w-full relative transition-all duration-500 ${result ? 'max-w-3xl' : 'max-w-2xl'}`}>
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-violet-500 rounded-2xl opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="例如：我最近刚升职做经理，但不知道怎么带团队，有点手忙脚乱..."
              className={`relative w-full bg-white border border-slate-200 rounded-xl focus:ring-0 focus:border-transparent resize-none text-slate-700 placeholder:text-slate-400 shadow-sm transition-all p-4 md:p-5 ${result ? 'h-16 py-3 pr-24 overflow-hidden' : 'h-32 text-lg'}`}
              onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleConsult(); } }}
            />
            
            <div className={`absolute right-2 flex items-center gap-2 ${result ? 'top-1/2 -translate-y-1/2' : 'bottom-3'}`}>
               <Button 
                 onClick={handleConsult} 
                 isLoading={loading} 
                 disabled={!request.trim()} 
                 className={`${result ? 'h-10 px-4' : 'h-10 px-6'} bg-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-900/20`}
               >
                 {loading ? '分析中...' : <Send size={18} className={result ? '' : 'mr-2'} />}
                 {!result && !loading && "咨询"}
               </Button>
            </div>
          </div>
          {!result && (
            <div className="text-center mt-4 text-xs text-slate-400 animate-in fade-in slide-in-from-top-2">
              DeepRead 将首先检索您的私人书库，再寻找外部智慧
            </div>
          )}
        </div>
      </div>

      {/* 2. Results Section */}
      {result && (
        <div ref={resultRef} className="flex-1 overflow-y-auto custom-scrollbar pb-20 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="max-w-5xl mx-auto space-y-10">
            
            {/* A. Analysis Card */}
            <div className="bg-gradient-to-br from-indigo-50/80 to-white p-6 md:p-8 rounded-2xl border border-indigo-100 shadow-sm relative overflow-hidden">
               <Quote className="absolute top-4 right-4 text-indigo-100 w-20 h-20 -rotate-12" />
               <div className="flex gap-4 relative z-10">
                 <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-200">
                   <Bot size={20} />
                 </div>
                 <div className="flex-1">
                   <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-2">顾问洞察</h4>
                   <p className="text-slate-700 leading-relaxed text-lg font-serif">
                     {result.analysis}
                   </p>
                 </div>
               </div>
            </div>

            {/* B. Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Library Matches (Left/Top) */}
              <div className="lg:col-span-12 space-y-4">
                 <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                    <Library size={18} className="text-emerald-600" />
                    <h3 className="font-bold text-slate-800">书库匹配</h3>
                    <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium border border-emerald-100">
                      现有 {result.libraryMatches.length} 本
                    </span>
                 </div>

                 {result.libraryMatches.length === 0 ? (
                    <div className="bg-slate-50 rounded-xl p-8 text-center border border-dashed border-slate-200">
                      <p className="text-slate-400 text-sm">您的书库中暂无直接相关的书籍</p>
                    </div>
                 ) : (
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     {result.libraryMatches.map((match, idx) => {
                        const book = getLibraryBook(match.bookId);
                        if (!book) return null;
                        return (
                          <div key={idx} onClick={() => onSelectBook(book)} className="group cursor-pointer bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:shadow-md transition-all flex gap-4">
                             <div className="w-16 h-24 bg-emerald-900 rounded shrink-0 shadow-md flex items-center justify-center text-emerald-100/30 font-serif font-bold text-xl">
                               {book.title[0]}
                             </div>
                             <div className="flex-1 min-w-0">
                               <div className="flex justify-between items-start">
                                 <h4 className="font-bold text-slate-900 font-serif truncate pr-2 group-hover:text-emerald-700 transition-colors">{book.title}</h4>
                                 <span className="shrink-0 text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-medium">已收藏</span>
                               </div>
                               <p className="text-xs text-slate-500 mb-2">{book.author}</p>
                               <div className="bg-slate-50 p-2 rounded text-xs text-slate-600 leading-relaxed group-hover:bg-emerald-50/30 transition-colors">
                                 {match.reason}
                               </div>
                             </div>
                          </div>
                        )
                     })}
                   </div>
                 )}
              </div>

              {/* External Recommendations (Full Width) */}
              <div className="lg:col-span-12 space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 mt-4">
                    <Sparkles size={18} className="text-indigo-600" />
                    <h3 className="font-bold text-slate-800">新书建议</h3>
                    <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium border border-indigo-100">
                      推荐 {result.externalMatches.length} 本
                    </span>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                   {result.externalMatches.map((rec, idx) => (
                     <div key={idx} className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg hover:border-indigo-200 transition-all flex flex-col h-full group">
                        {/* Fake Cover Top */}
                        <div className="h-2 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
                        <div className="p-5 flex-1 flex flex-col">
                           <div className="flex justify-between items-start mb-2">
                             <h4 className="font-bold text-lg text-slate-900 font-serif leading-tight group-hover:text-indigo-700 transition-colors">
                               {rec.title}
                             </h4>
                           </div>
                           <p className="text-xs text-slate-500 mb-4">{rec.author}</p>
                           
                           <div className="flex flex-wrap gap-2 mb-4">
                             <span className={`text-[10px] px-2 py-0.5 rounded border ${
                               rec.level === 'Basic' ? 'bg-green-50 text-green-700 border-green-100' : 
                               rec.level === 'Advanced' ? 'bg-yellow-50 text-yellow-700 border-yellow-100' : 'bg-red-50 text-red-700 border-red-100'
                             }`}>
                               {rec.level}
                             </span>
                             {rec.category && <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200">{rec.category}</span>}
                           </div>

                           <div className="relative mb-6">
                             <Quote className="absolute -top-2 -left-1 text-slate-200 w-4 h-4 transform -scale-x-100" />
                             <p className="text-sm text-slate-600 pl-4 leading-relaxed border-l-2 border-indigo-100">
                               {rec.reason}
                             </p>
                           </div>

                           <Button 
                             onClick={() => onAddBook(rec)} 
                             variant="outline"
                             className="mt-auto w-full border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 group/btn"
                           >
                             <Plus size={16} className="mr-2 group-hover/btn:scale-110 transition-transform" /> 加入书库
                           </Button>
                        </div>
                     </div>
                   ))}
                 </div>
              </div>
            
            </div>
          </div>
        </div>
      )}
    </div>
  );
};