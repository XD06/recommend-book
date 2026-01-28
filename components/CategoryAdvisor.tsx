import React, { useState } from 'react';
import { Book, Recommendation } from '../types';
import { Sparkles, ArrowRight, Plus, X, BookOpen, ChevronRight, MessageSquare, Quote } from 'lucide-react';
import { Button } from './Button';
import { recommendBooks } from '../services/geminiService';

interface CategoryAdvisorProps {
  category: string;
  subcategory?: string | null;
  books: Book[];
  onAddBook: (rec: Recommendation) => void;
}

export const CategoryAdvisor: React.FC<CategoryAdvisorProps> = ({ category, subcategory, books, onAddBook }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [requirements, setRequirements] = useState('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);

  // Dynamic context text based on depth
  const contextText = subcategory 
    ? `${category} > ${subcategory}` 
    : category;

  const handleRecommend = async () => {
    setLoading(true);
    setRecommendations([]);
    try {
      // Pass the current books context + subcategory + user requirements
      const recs = await recommendBooks(books, category, subcategory, requirements);
      setRecommendations(recs);
    } catch (error) {
      console.error(error);
      alert("AI 响应失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className="w-full bg-white border border-indigo-100 p-3 md:p-4 rounded-xl flex items-center justify-between group hover:shadow-md hover:border-indigo-200 transition-all duration-300"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg shadow-indigo-100 group-hover:scale-110 transition-transform">
            <Sparkles size={18} />
          </div>
          <div className="text-left">
            <h3 className="font-bold text-slate-800 text-sm flex items-center">
              需要《{contextText}》领域的建议？
            </h3>
            <p className="text-slate-400 text-xs mt-0.5">
              基于 {books.length} 本藏书的智能补全
            </p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
          <ArrowRight size={16} />
        </div>
      </button>
    );
  }

  return (
    <div className="bg-white border border-indigo-100 rounded-xl shadow-xl shadow-indigo-900/5 overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-4">
      {/* Header */}
      <div className="bg-slate-50/50 p-4 border-b border-slate-100 flex justify-between items-start">
        <div className="flex gap-3">
          <div className="mt-1 p-1.5 bg-indigo-100 text-indigo-600 rounded-lg">
             <Sparkles size={16} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1 flex-wrap">
              AI 选书顾问
              <ChevronRight size={14} className="text-slate-300"/>
              <span className="bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-600">{category}</span>
              {subcategory && (
                <>
                  <ChevronRight size={14} className="text-slate-300"/>
                  <span className="bg-indigo-50 px-1.5 py-0.5 rounded text-xs text-indigo-700">{subcategory}</span>
                </>
              )}
            </h3>
            <p className="text-slate-500 text-xs mt-1.5 leading-relaxed max-w-xl">
              告诉我您的具体阅读目标（例如：“想找关于该领域发展史的书”），或者留空让我自由发挥。
            </p>
          </div>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
          <X size={16} />
        </button>
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <div className="absolute top-2.5 left-3 text-slate-400">
              <MessageSquare size={16} />
            </div>
            <input 
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="例如：推荐一些适合入门的经典教材..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all"
              onKeyDown={(e) => e.key === 'Enter' && handleRecommend()}
            />
          </div>
          <Button onClick={handleRecommend} isLoading={loading} className="shrink-0 shadow-sm shadow-indigo-200 h-9 text-sm">
            开始推荐
          </Button>
        </div>
      </div>

      {/* Results Area */}
      {recommendations.length > 0 && (
        <div className="p-4 bg-slate-50/50 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-4">
             <div className="h-px bg-slate-200 flex-1"></div>
             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">为您精选</span>
             <div className="h-px bg-slate-200 flex-1"></div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recommendations.map((rec, idx) => (
              <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-md transition-all group flex flex-col h-full">
                <div className="flex justify-between items-start mb-2">
                  <h5 className="font-serif font-bold text-slate-900 text-base leading-tight group-hover:text-indigo-700 transition-colors line-clamp-2">
                    {rec.title}
                  </h5>
                  <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                    rec.level === 'Basic' ? 'bg-green-50 text-green-700 border-green-100' :
                    rec.level === 'Advanced' ? 'bg-yellow-50 text-yellow-700 border-yellow-100' : 'bg-red-50 text-red-700 border-red-100'
                  }`}>
                    {rec.level}
                  </span>
                </div>
                
                <p className="text-xs text-slate-500 mb-3 font-medium">{rec.author}</p>
                
                <div className="flex-1 mb-4">
                   <div className="relative">
                     <Quote size={12} className="absolute -top-1 -left-1 text-indigo-200 fill-indigo-50" />
                     <p className="text-xs text-slate-600 leading-relaxed pl-3 border-l-2 border-indigo-100">
                       {rec.reason}
                     </p>
                   </div>
                </div>

                <Button size="sm" variant="outline" onClick={() => onAddBook(rec)} className="w-full mt-auto bg-transparent hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 group/btn">
                  <Plus size={14} className="mr-1 group-hover/btn:scale-110 transition-transform" /> 收藏
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};