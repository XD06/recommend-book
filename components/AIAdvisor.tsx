import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Book, AdvisorResponse, Recommendation, ReadingMood, MOOD_OPTIONS, getBookCoverUrl, hasBookCover } from '../types';
import { Button } from './Button';
import { getRecommendationsStream } from '../services/geminiService';
import { AIActivityPanel, useAIActivity } from './AIActivityPanel';
import {
  Sparkle, PaperPlaneTilt, Plus, Star, Robot, Stack, Lightbulb, Clock, Eye, CheckCircle,
} from '@phosphor-icons/react';

// Fallback response when API fails
const fallbackResponse: AdvisorResponse = {
  analysis: 'AI 服务暂时不可用，请稍后重试。',
  libraryMatches: [],
  externalMatches: [],
};

interface AIAdvisorProps {
  books: Book[];
  onSelectBook: (book: Book) => void;
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

export const AIAdvisor: React.FC<AIAdvisorProps> = ({ books, onSelectBook, onAddBook }) => {
  const [request, setRequest] = useState('');
  const [selectedMood, setSelectedMood] = useState<ReadingMood | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdvisorResponse | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ai = useAIActivity();

  const handleConsult = async () => {
    if (!request.trim() && !selectedMood) return;
    setLoading(true);
    setResult(null);
    ai.reset();
    ai.startTimer();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const moodContext = selectedMood
        ? `用户当前心境：${MOOD_OPTIONS.find(m => m.value === selectedMood)?.label} - ${MOOD_OPTIONS.find(m => m.value === selectedMood)?.description}。`
        : '';
      const fullRequest = moodContext + (request.trim() || MOOD_OPTIONS.find(m => m.value === selectedMood)?.description || '');

      const data = await getRecommendationsStream(
        {
          userRequest: fullRequest,
          userMood: selectedMood || undefined,
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

      const finalResult: AdvisorResponse = data || fallbackResponse;
      finalResult.libraryMatches = finalResult.libraryMatches || [];
      finalResult.externalMatches = finalResult.externalMatches || [];
      setResult(finalResult);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setResult(fallbackResponse);
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

  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  const getLibraryBook = (id: string) => books.find((b) => b.id === id);

  return (
    <div className="flex flex-col min-h-[calc(100dvh-8rem)] md:min-h-[calc(100dvh-4rem)] max-w-4xl mx-auto px-4 md:px-0">
      {/* Input section */}
      <div className={`transition-all duration-500 ease-out-expo flex flex-col items-center justify-center ${result || loading ? 'py-6' : 'flex-1 py-8 md:py-12'}`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
        {/* Title */}
        <div className={`text-center transition-all duration-500 ${result || loading ? 'mb-5' : 'mb-8'}`}>
          <div className={`rounded-2xl bg-zinc-900 text-white flex items-center justify-center mx-auto mb-4 transition-all duration-500 ${result || loading ? 'w-10 h-10' : 'w-14 h-14'}`}>
            <Sparkle size={result || loading ? 20 : 28} weight="fill" />
          </div>
          <h2 className={`font-bold text-zinc-900 transition-all duration-300 ${result || loading ? 'text-lg' : 'text-2xl md:text-3xl'}`}>
            {result ? 'AI 阅读顾问' : loading ? 'AI 正在思考...' : '此刻你想读什么？'}
          </h2>
          {!result && !loading && (
            <p className="text-zinc-500 text-sm mt-2 max-w-md mx-auto leading-relaxed">
              告诉我你的心境、目标或困惑，我会从你的书库和全网为你找到最合适的书。
            </p>
          )}
        </div>

        {/* Mood selector */}
        <div className="w-full max-w-2xl mb-4">
          <div className="flex flex-wrap gap-2 justify-center">
            {MOOD_OPTIONS.map((mood) => (
              <button
                key={mood.value}
                onClick={() => setSelectedMood(selectedMood === mood.value ? null : mood.value)}
                disabled={loading}
                className={[
                  'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors duration-150',
                  'active:scale-[0.97]',
                  selectedMood === mood.value
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50',
                  loading ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
                style={{ transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
              >
                <span className="mr-1">{mood.emoji}</span>
                {mood.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input box */}
        <div className="w-full max-w-2xl relative">
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="例如：我刚升职做技术管理，有点手忙脚乱..."
            className={`w-full bg-white border border-zinc-200 rounded-xl resize-none text-sm text-zinc-900 placeholder:text-zinc-400 shadow-subtle transition-[height,border-color] duration-300 ease-out p-4 pr-16 ${result || loading ? 'h-14 py-3' : 'h-28'}`}
            style={{ transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleConsult(); } }}
            disabled={loading}
          />
          <div className={`absolute right-2 flex items-center ${result || loading ? 'top-1/2 -translate-y-1/2' : 'bottom-3'}`}>
            <Button
              onClick={handleConsult}
              isLoading={loading}
              disabled={!request.trim() && !selectedMood}
              size="sm"
              className="bg-zinc-900 hover:bg-zinc-800"
            >
              {loading ? '' : <PaperPlaneTilt size={16} weight="fill" />}
              {!result && !loading && '咨询'}
            </Button>
          </div>
        </div>
      </div>

      {/* AI 活动面板 */}
      {loading && (
        <div className="flex-1 pb-8 md:pb-12">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 md:p-6"
          >
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-zinc-900 text-white flex items-center justify-center shrink-0">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Robot size={18} weight="fill" />
                </motion.div>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">AI 阅读顾问</h4>
                <AIActivityPanel
                  phase={ai.phase}
                  toolCalls={ai.toolCalls}
                  reasoningText={ai.reasoningText}
                  elapsedTime={ai.elapsedTime}
                  receivedChars={ai.receivedChars}
                  onCancel={handleStop}
                  thinkingLabel="正在分析你的书库"
                  generatingLabel="正在生成推荐结果"
                />
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div ref={resultRef} className="flex-1 pb-8 md:pb-12 space-y-6 animate-slide-up">
          {/* Analysis */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 md:p-6">
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-zinc-900 text-white flex items-center justify-center shrink-0">
                <Robot size={18} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">顾问洞察</h4>
                <p className="text-zinc-700 leading-relaxed text-[15px]">{result.analysis}</p>
                {result.readingInsight && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50/60 px-3 py-2">
                    <Lightbulb size={16} className="text-amber-500 shrink-0 mt-0.5" weight="fill" />
                    <p className="text-xs text-amber-800 leading-relaxed">{result.readingInsight}</p>
                  </div>
                )}
                {result.recommendationStrategy && (
                  <div className="mt-2 flex items-start gap-2">
                    <Eye size={14} className="text-zinc-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-zinc-500 leading-relaxed">推荐策略：{result.recommendationStrategy}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Library matches */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Stack size={18} className="text-accent-600" />
              <h3 className="font-semibold text-zinc-900 text-sm">书库匹配</h3>
              <span className="badge bg-accent-50 text-accent-700">{result.libraryMatches.length} 本</span>
            </div>
            {result.libraryMatches.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-center">
                <p className="text-sm text-zinc-400">书库中暂无直接相关的书籍</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {result.libraryMatches.map((match, idx) => {
                  const book = getLibraryBook(match.bookId);
                  if (!book) return null;
                  return (
                    <div
                      key={idx}
                      onClick={() => onSelectBook(book)}
                      className="group cursor-pointer rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:shadow-card-hover transition-[border-color,box-shadow] duration-200"
                    >
                      <div className="flex gap-3">
                        {hasBookCover(book) ? (
                          <img
                            src={getBookCoverUrl(book)}
                            alt={book.title}
                            className="w-10 h-14 rounded shrink-0 object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <div
                            className="w-10 h-14 rounded shrink-0 flex items-center justify-center text-white/20 font-bold text-lg"
                            style={{ backgroundColor: book.coverColor || '#059669' }}
                          >
                            {book.title[0]}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm text-zinc-900 truncate group-hover:text-accent-700 transition-colors">{book.title}</h4>
                          <p className="text-xs text-zinc-400 mb-2">{book.author}</p>
                          <p className="text-xs text-zinc-600 leading-relaxed line-clamp-2">{match.reason}</p>
                          {match.timing && (
                            <div className="mt-1.5 flex items-start gap-1">
                              <Clock size={11} className="text-emerald-500 shrink-0 mt-0.5" />
                              <p className="text-[11px] text-emerald-600 leading-relaxed line-clamp-1">{match.timing}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* External recommendations */}
          {result.externalMatches.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkle size={18} className="text-zinc-900" />
                <h3 className="font-semibold text-zinc-900 text-sm">新书建议</h3>
                <span className="badge bg-zinc-100 text-zinc-600">{result.externalMatches.length} 本</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {result.externalMatches.map((rec, idx) => (
                  <div key={idx} className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col hover:border-zinc-300 hover:shadow-card-hover transition-[border-color,box-shadow] duration-200">
                    <h4 className="font-semibold text-sm text-zinc-900 leading-snug mb-0.5 line-clamp-2">{rec.title}</h4>
                    <p className="text-xs text-zinc-400 mb-2">{rec.author}</p>
                    <div className="flex flex-wrap gap-1 mb-3">
                      <span className={`badge ${levelBadge[rec.level] || 'bg-zinc-100 text-zinc-600'}`}>{levelText[rec.level] || rec.level}</span>
                      {rec.rating && (
                        <span className="badge bg-amber-50 text-amber-700">
                          <Star size={11} weight="fill" className="text-amber-400" /> {rec.rating}
                        </span>
                      )}
                      {rec.category && <span className="badge bg-zinc-100 text-zinc-500">{rec.category}</span>}
                    </div>
                    <p className="text-xs text-zinc-600 leading-relaxed mb-2 flex-1 border-l-2 border-zinc-200 pl-3">{rec.reason}</p>
                    {rec.confidence && (
                      <div className="flex items-center gap-1 mb-3">
                        <CheckCircle size={12} className={
                          rec.confidence === 'high' ? 'text-emerald-500'
                          : rec.confidence === 'medium' ? 'text-amber-500'
                          : 'text-zinc-400'
                        } />
                        <span className="text-[10px] text-zinc-400">
                          {rec.confidence === 'high' ? '高可信度' : rec.confidence === 'medium' ? '中等可信度' : '可信度较低'}
                        </span>
                      </div>
                    )}
                    <Button size="sm" variant="outline" onClick={() => onAddBook(rec)} className="w-full">
                      <Plus size={14} /> 加入书库
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
