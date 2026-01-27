import React, { useState } from 'react';
import { Recommendation, BookLevel, CategoryGroup, Book } from '../types';
import { Button } from './Button';
import { recommendBooks } from '../services/geminiService';
import { Send, Sparkles, User, Bot, BookOpen, Plus, Loader2, Search } from 'lucide-react';

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
  
  // Suggested quick prompts
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
      // Determine category context. If user selected one, use it. 
      // If not, use "General/Mixed" or infer from query (simplified here to pass a generic label if empty)
      const catContext = selectedCategory || "综合领域";
      
      // Filter books if a category is selected to give AI context on what we have in that specific field
      const relevantBooks = selectedCategory 
        ? books.filter(b => b.category === selectedCategory) 
        : books;

      // Pass null for subcategory to maintain old behavior (general context or specified in prompt)
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
      <div className="w-full lg:w-1/3 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-900 flex items-center">
            <Sparkles className="text-indigo-600 mr-2" size={20} />
            智能馆员
          </h2>
          <p className="text-xs text-slate-500 mt-1">告诉我有具体要求的书，或选择分类进行通用推荐。</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* AI Greeting */}
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Bot size={18} />
            </div>
            <div className="bg-slate-100 p-4 rounded-2xl rounded-tl-none text-sm text-slate-700 leading-relaxed">
              您好！我是您的专属 AI 馆员。您想探索哪个领域的知识？或者直接告诉我您的具体需求（例如：“想找关于宋朝生活史的经典”）。
            </div>
          </div>

          {/* User Input Display (Visual only for now, reflects current state) */}
          {query && !isTyping && recommendations && (
             <div className="flex gap-4 flex-row-reverse animate-in slide-in-from-bottom-2">
               <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-white shrink-0">
                 <User size={18} />
               </div>
               <div className="bg-indigo-600 text-white p-4 rounded-2xl rounded-tr-none text-sm leading-relaxed shadow-md shadow-indigo-200">
                 {query}
               </div>
             </div>
          )}

          {/* Quick Prompts */}
          {!recommendations && !isTyping && (
            <div className="space-y-2 mt-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">试一试</p>
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => { setQuery(prompt); handleSearch(prompt); }}
                  className="block w-full text-left p-3 rounded-xl border border-slate-100 text-sm text-slate-600 hover:bg-indigo-50 hover:border-indigo-100 hover:text-indigo-700 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          
          {/* Category Filter (Optional Context) */}
          {!recommendations && (
             <div className="mt-4">
               <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">或按已有分类探索</p>
               <div className="flex flex-wrap gap-2">
                 {categories.map(cat => (
                   <button
                     key={cat.name}
                     onClick={() => setSelectedCategory(cat.name === selectedCategory ? '' : cat.name)}
                     className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                       selectedCategory === cat.name 
                         ? 'bg-slate-800 text-white border-slate-800' 
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
        <div className="p-4 border-t border-slate-100 bg-white">
          <div className="relative">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={selectedCategory ? `在 "${selectedCategory}" 类目下寻找...` : "输入您的选书要求..."}
              className="w-full pl-4 pr-12 py-3 bg-slate-50 border-0 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 resize-none h-14"
              onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
            />
            <button 
              onClick={() => handleSearch()}
              disabled={isTyping || (!query && !selectedCategory)}
              className="absolute right-2 top-2 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isTyping ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Right Panel: Results */}
      <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200/60 p-6 overflow-y-auto custom-scrollbar">
        {!recommendations && !isTyping ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-60">
            <Search size={48} className="mb-4" />
            <p className="text-lg font-medium">准备好探索知识海洋了吗？</p>
            <p className="text-sm">在左侧输入需求，获取定制书单。</p>
          </div>
        ) : isTyping ? (
          <div className="space-y-4">
             {[1, 2, 3].map(i => (
               <div key={i} className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm animate-pulse">
                 <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
                 <div className="h-4 bg-slate-100 rounded w-1/2 mb-2"></div>
                 <div className="h-20 bg-slate-50 rounded w-full"></div>
               </div>
             ))}
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-end">
               <h3 className="text-xl font-bold text-slate-900">推荐结果</h3>
               <span className="text-xs font-medium text-slate-500 bg-white px-2 py-1 rounded-md border border-slate-200">
                 找到 {recommendations?.length} 本相关书籍
               </span>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {recommendations?.map((rec, idx) => (
                <div key={idx} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row gap-5">
                   {/* Visual Spine Placeholder */}
                   <div className="hidden md:block w-24 shrink-0 bg-stone-100 rounded-lg border border-stone-200 relative overflow-hidden">
                      <div className="absolute inset-0 flex items-center justify-center p-2 text-center">
                        <span className="font-serif font-bold text-stone-400 text-xs leading-tight line-clamp-3">{rec.title}</span>
                      </div>
                      <div className="absolute left-1 top-0 bottom-0 w-1 bg-stone-300/30"></div>
                   </div>

                   <div className="flex-1 py-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          rec.level === 'Basic' ? 'bg-green-100 text-green-700' :
                          rec.level === 'Advanced' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {rec.level}
                        </span>
                        <h4 className="font-serif font-bold text-lg text-slate-900">{rec.title}</h4>
                      </div>
                      
                      <div className="text-sm text-slate-600 mb-3 space-y-1">
                         <div className="flex items-center">
                           <User size={14} className="mr-2 text-slate-400" /> {rec.author}
                         </div>
                         <div className="flex items-center text-indigo-700 font-medium bg-indigo-50/50 w-fit px-2 py-0.5 rounded">
                           <BookOpen size={14} className="mr-2" /> {rec.publisher}
                         </div>
                      </div>

                      <div className="bg-stone-50 p-3 rounded-lg border border-stone-100">
                        <p className="text-sm text-stone-700 leading-relaxed">
                          <span className="font-bold text-stone-900 mr-1">推荐理由:</span>
                          {rec.reason}
                        </p>
                      </div>

                      <div className="mt-4 flex justify-end">
                        <Button size="sm" onClick={() => onAddBook(rec)} className="shadow-sm">
                          <Plus size={16} className="mr-2" /> 加入书库
                        </Button>
                      </div>
                   </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};