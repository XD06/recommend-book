import React, { useState } from 'react';
import { Recommendation, BookLevel, CategoryGroup, Book } from '../types';
import { Button } from './Button';
import { recommendBooks } from '../services/geminiService';
import { Send, Sparkles, User, Bot, BookOpen, Plus, Loader2, Search, Quote } from 'lucide-react';

interface BookExplorerProps {
  categories: CategoryGroup[];
  books: Book[];
  onAddBook: (rec: Recommendation) => void;
}

export const BookExplorer: React.FC<BookExplorerProps> = ({ categories, books, onAddBook }) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  
  const quickPrompts = [
    "我想找一些关于二战历史的深度书籍",
    "推荐几本适合入门的心理学经典",
    "找一些类似《三体》的硬科幻小说",
    "最近很焦虑，有没有哲学书推荐？"
  ];

  const handleSearch = async (customPrompt?: string) => {
    const finalPrompt = customPrompt || query;
    if (!finalPrompt.trim() && !selectedCategory) return;

    setIsTyping(true);
    setRecommendations(null);

    try {
      const catContext = selectedCategory || "综合领域";
      const relevantBooks = selectedCategory 
        ? books.filter(b => b.category === selectedCategory) 
        : books;

      const recs = await recommendBooks(relevantBooks, catContext, null, finalPrompt);
      setRecommendations(recs);
    } catch (e) {
      console.error(e);
      alert("AI 思考超时，请重试。");
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-6rem)]">
      
      {/* Left Panel: Chat / Controls */}
      <div className="w-full lg:w-1/3 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-full">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <Sparkles className="text-indigo-600 mr-2" size={20} />
            智能馆员
          </h2>
          <p className="text-xs text-slate-500 mt-1">告诉我有具体要求的书，或选择分类进行通用推荐。</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/30">
          {/* AI Greeting */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-indigo-200">
              <Bot size={16} />
            </div>
            <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none text-sm text-slate-700 leading-relaxed shadow-sm">
              您好！我是您的专属 AI 馆员。您想探索哪个领域的知识？
            </div>
          </div>

          {/* User Input Display */}
          {query && !isTyping && recommendations && (
             <div className="flex gap-3 flex-row-reverse animate-in slide-in-from-bottom-2">
               <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-white shrink-0">
                 <User size={16} />
               </div>
               <div className="bg-slate-800 text-white p-4 rounded-2xl rounded-tr-none text-sm leading-relaxed shadow-md">
                 {query}
               </div>
             </div>
          )}

          {/* Quick Prompts */}
          {!recommendations && !isTyping && (
            <div className="space-y-3 px-11">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">试一试</p>
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => { setQuery(prompt); handleSearch(prompt); }}
                  className="block w-full text-left p-3 rounded-xl bg-white border border-slate-100 text-sm text-slate-600 hover:border-indigo-300 hover:shadow-sm transition-all text-xs"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          
          {/* Category Filter */}
          {!recommendations && (
             <div className="px-11">
               <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">或按分类探索</p>
               <div className="flex flex-wrap gap-2">
                 {categories.map(cat => (
                   <button
                     key={cat.name}
                     onClick={() => setSelectedCategory(cat.name === selectedCategory ? '' : cat.name)}
                     className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                       selectedCategory === cat.name 
                         ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' 
                         : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                     }`}
                   >
                     {cat.name}
                   </button>
                 ))}
               </div>
             </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-100">
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl opacity-20 group-hover:opacity-40 transition blur"></div>
            <div className="relative flex bg-white rounded-xl items-center">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={selectedCategory ? `在 "${selectedCategory}" 下寻找...` : "输入您的选书要求..."}
                className="w-full pl-4 pr-12 py-3 bg-transparent border-none focus:ring-0 text-sm resize-none h-14"
                onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
              />
              <button 
                onClick={() => handleSearch()}
                disabled={isTyping || (!query && !selectedCategory)}
                className="absolute right-2 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:bg-slate-200 transition-colors shadow-sm"
              >
                {isTyping ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel: Results */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 p-0 overflow-hidden flex flex-col h-full">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {!recommendations && !isTyping ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-300">
              <Search size={64} className="mb-6 opacity-50" />
              <p className="text-xl font-serif font-medium text-slate-400">准备好探索知识海洋了吗？</p>
            </div>
          ) : isTyping ? (
            <div className="space-y-4">
               {[1, 2, 3].map(i => (
                 <div key={i} className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm animate-pulse flex gap-4">
                   <div className="w-20 h-28 bg-slate-100 rounded"></div>
                   <div className="flex-1 space-y-3">
                     <div className="h-6 bg-slate-100 rounded w-1/3"></div>
                     <div className="h-4 bg-slate-50 rounded w-1/4"></div>
                     <div className="h-16 bg-slate-50 rounded w-full"></div>
                   </div>
                 </div>
               ))}
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex justify-between items-end pb-4 border-b border-slate-100">
                 <h3 className="text-lg font-bold text-slate-900">推荐结果</h3>
                 <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                   找到 {recommendations?.length} 本
                 </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {recommendations?.map((rec, idx) => (
                  <div key={idx} className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg hover:border-indigo-300 transition-all flex flex-col group">
                     <div className="p-5 flex gap-5">
                        {/* Styled Spine */}
                        <div className="w-16 h-24 shrink-0 bg-stone-100 border border-stone-200 rounded flex items-center justify-center text-center p-1 shadow-sm relative overflow-hidden group-hover:bg-indigo-50 group-hover:border-indigo-100 transition-colors">
                           <span className="font-serif font-bold text-[10px] text-stone-500 line-clamp-3 leading-tight group-hover:text-indigo-800">{rec.title}</span>
                           <div className="absolute left-0.5 top-0 bottom-0 w-0.5 bg-stone-300/30"></div>
                        </div>

                        <div className="flex-1 min-w-0">
                           <div className="flex justify-between items-start mb-1">
                             <h4 className="font-serif font-bold text-lg text-slate-900 truncate pr-2">{rec.title}</h4>
                           </div>
                           <p className="text-xs text-slate-500 mb-2">{rec.author}</p>
                           <span className={`text-[10px] px-2 py-0.5 rounded border ${
                              rec.level === 'Basic' ? 'bg-green-50 text-green-700 border-green-100' : 
                              rec.level === 'Advanced' ? 'bg-yellow-50 text-yellow-700 border-yellow-100' : 'bg-red-50 text-red-700 border-red-100'
                           }`}>
                             {rec.level}
                           </span>
                        </div>
                     </div>

                     <div className="px-5 pb-5 flex-1 flex flex-col">
                        <div className="relative mb-4 flex-1">
                          <p className="text-sm text-slate-600 leading-relaxed pl-3 border-l-2 border-indigo-100 text-justify">
                            {rec.reason}
                          </p>
                        </div>
                        <Button size="sm" onClick={() => onAddBook(rec)} variant="outline" className="w-full hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200">
                          <Plus size={16} className="mr-2" /> 加入书库
                        </Button>
                     </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};