import React, { useState } from 'react';
import { Book, Recommendation } from '../types';
import { Sparkles, ArrowRight, Plus, Loader2, MessageSquare, X, BookOpen } from 'lucide-react';
import { Button } from './Button';
import { recommendBooks } from '../services/geminiService';

interface CategoryAdvisorProps {
  category: string;
  books: Book[];
  onAddBook: (rec: Recommendation) => void;
}

export const CategoryAdvisor: React.FC<CategoryAdvisorProps> = ({ category, books, onAddBook }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [requirements, setRequirements] = useState('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);

  const handleRecommend = async () => {
    setLoading(true);
    setRecommendations([]);
    try {
      // Pass the current books context + user requirements
      const recs = await recommendBooks(books, category, requirements);
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
        className="w-full bg-gradient-to-r from-indigo-50 to-white border border-indigo-100 p-4 rounded-xl flex items-center justify-between group hover:shadow-md transition-all duration-300"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-indigo-200 shadow-lg">
            <Sparkles size={20} />
          </div>
          <div className="text-left">
            <h3 className="font-bold text-slate-900 text-sm">需要《{category}》领域的选书建议？</h3>
            <p className="text-slate-500 text-xs mt-0.5">
              基于您现有的 {books.length} 本书，AI 将为您推荐补充读物
            </p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:border-indigo-200 transition-colors">
          <ArrowRight size={16} />
        </div>
      </button>
    );
  }

  return (
    <div className="bg-white border border-indigo-100 rounded-xl shadow-lg shadow-indigo-900/5 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="bg-indigo-50/50 p-4 border-b border-indigo-100 flex justify-between items-start">
        <div className="flex gap-3">
          <div className="mt-1">
             <Sparkles size={18} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">AI 选书顾问 - {category} 专区</h3>
            <p className="text-slate-500 text-xs mt-1 leading-relaxed max-w-xl">
              我已经分析了您在这个分类下的 {books.length} 本藏书。
              <br/>您可以告诉我具体的阅读目标（例如：“想找关于该领域发展史的书”），或者留空让我自由发挥。
            </p>
          </div>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
          <X size={18} />
        </button>
      </div>

      {/* Input Area */}
      <div className="p-4 bg-slate-50/30">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <div className="absolute top-3 left-3 text-slate-400">
              <MessageSquare size={16} />
            </div>
            <input 
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="（选填）输入您的具体要求，例如：推荐一些入门级的经典教材..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleRecommend()}
            />
          </div>
          <Button onClick={handleRecommend} isLoading={loading} className="shrink-0 shadow-sm shadow-indigo-200">
            开始分析推荐
          </Button>
        </div>
      </div>

      {/* Results Area */}
      {recommendations.length > 0 && (
        <div className="p-4 border-t border-slate-100 bg-white">
          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">为您精选</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recommendations.map((rec, idx) => (
              <div key={idx} className="border border-slate-200 rounded-lg p-4 hover:border-indigo-200 hover:shadow-md transition-all group flex flex-col h-full bg-white">
                <div className="flex justify-between items-start mb-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                    rec.level === 'Basic' ? 'bg-green-50 text-green-700' :
                    rec.level === 'Advanced' ? 'bg-yellow-50 text-yellow-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {rec.level}
                  </span>
                  <BookOpen size={14} className="text-slate-300 group-hover:text-indigo-400" />
                </div>
                
                <h5 className="font-serif font-bold text-slate-900 mb-1">{rec.title}</h5>
                <p className="text-xs text-slate-500 mb-3">{rec.author} · {rec.publisher}</p>
                
                <div className="flex-1">
                  <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-2 rounded border border-slate-100 mb-4">
                    {rec.reason}
                  </p>
                </div>

                <Button size="sm" variant="outline" onClick={() => onAddBook(rec)} className="w-full mt-auto hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200">
                  <Plus size={14} className="mr-1" /> 加入书库
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};