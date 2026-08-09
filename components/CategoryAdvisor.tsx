import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, Recommendation } from '../types';
import { Button } from './Button';
import { getRecommendationsStream } from '../services/geminiService';
import { AIActivityPanel, useAIActivity } from './AIActivityPanel';
import { Sparkle, Plus, X, Star, ChatText, Robot } from '@phosphor-icons/react';

interface CategoryAdvisorProps {
  category: string;
  subcategory?: string | null;
  books: Book[];
  onAddBook: (rec: Recommendation) => void;
}

const levelBadge: Record<string, string> = {
  'Basic': 'bg-accent-50 text-accent-700',
  'Advanced': 'bg-blue-50 text-blue-700',
  'Expert': 'bg-rose-50 text-rose-700',
};

const levelText: Record<string, string> = {
  'Basic': '入门',
  'Advanced': '进阶',
  'Expert': '专家',
};

export const CategoryAdvisor: React.FC<CategoryAdvisorProps> = ({ category, subcategory, books, onAddBook }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [requirements, setRequirements] = useState('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const ai = useAIActivity();

  const contextText = subcategory ? `${category} > ${subcategory}` : category;

  const handleRecommend = async () => {
    setLoading(true);
    setRecommendations([]);
    ai.reset();
    ai.startTimer();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const userRequest = requirements.trim() || `我想在 ${contextText} 领域找书`;
      const data = await getRecommendationsStream(
        {
          userRequest,
          library: books,
        },
        {
          onPhase: (phase) => ai.handlePhase(phase),
          onToolCall: (toolName, label, round) => ai.handleToolCall(toolName, label, round),
          onChunk: (chunk) => ai.handleChunk(chunk),
          onReasoning: ai.handleReasoning,
        },
        controller.signal,
      );

      const externalMatches = data?.externalMatches || [];
      setRecommendations(externalMatches);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setRecommendations([]);
      }
    } finally {
      setLoading(false);
      ai.stopTimer();
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    ai.reset();
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full rounded-xl border border-zinc-200 bg-white p-3 flex items-center justify-between group hover:border-zinc-300 hover:shadow-subtle transition-[border-color,box-shadow] duration-200"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-zinc-900 text-white flex items-center justify-center">
            <Sparkle size={16} weight="fill" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-medium text-zinc-900">需要 {contextText} 领域的建议？</h3>
            <p className="text-xs text-zinc-400 mt-0.5">基于 {books.length} 本藏书的智能补全</p>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-card overflow-hidden animate-scale-in">
      <div className="p-4 border-b border-zinc-100 flex justify-between items-start">
        <div className="flex gap-3">
          <div className="w-9 h-9 rounded-lg bg-zinc-900 text-white flex items-center justify-center shrink-0">
            <Sparkle size={16} weight="fill" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">AI 选书顾问</h3>
            <p className="text-xs text-zinc-400 mt-0.5">{contextText}</p>
          </div>
        </div>
        <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors duration-150">
          <X size={16} />
        </button>
      </div>

      <div className="p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ChatText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="描述你的阅读目标，或留空让 AI 自由推荐..."
              className="input-base pl-9"
              onKeyDown={(e) => e.key === 'Enter' && handleRecommend()}
              disabled={loading}
            />
          </div>
          {loading ? (
            <Button size="sm" onClick={handleStop} className="shrink-0 bg-rose-500 hover:bg-rose-600 text-white">
              取消
            </Button>
          ) : (
            <Button size="sm" onClick={handleRecommend} className="shrink-0">
              推荐
            </Button>
          )}
        </div>
      </div>

      {/* AI 活动面板 */}
      {loading && (
        <div className="px-4 pb-4">
          <div className="rounded-lg bg-zinc-50 p-3">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center shrink-0">
                <Robot size={16} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <AIActivityPanel
                  phase={ai.phase}
                  toolCalls={ai.toolCalls}
                  reasoningText={ai.reasoningText}
                  elapsedTime={ai.elapsedTime}
                  receivedChars={ai.receivedChars}
                  onCancel={handleStop}
                  thinkingLabel="正在分析你的书库"
                  generatingLabel="正在生成推荐"
                  compact
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {recommendations.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-4 bg-zinc-50/50 border-t border-zinc-100 overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {recommendations.map((rec, idx) => (
                <div key={idx} className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col">
                  <h5 className="font-semibold text-sm text-zinc-900 leading-snug line-clamp-2 mb-0.5">{rec.title}</h5>
                  <p className="text-xs text-zinc-400 mb-2">{rec.author}</p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    <span className={`badge ${levelBadge[rec.level] || 'bg-zinc-100 text-zinc-600'}`}>{levelText[rec.level] || rec.level}</span>
                    {rec.rating && (
                      <span className="badge bg-amber-50 text-amber-700">
                        <Star size={11} weight="fill" className="text-amber-400" /> {rec.rating}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed mb-3 flex-1 border-l-2 border-zinc-200 pl-3">{rec.reason}</p>
                  <Button size="sm" variant="outline" onClick={() => onAddBook(rec)} className="w-full">
                    <Plus size={14} /> 收藏
                  </Button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
