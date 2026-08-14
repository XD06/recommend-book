import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Book, AdvisorResponse, Recommendation, ReadingMood, MOOD_OPTIONS, getBookCoverUrl, hasBookCover } from '../types';
import { Button } from './Button';
import { getRecommendationsStream } from '../services/geminiService';
import { AIActivityPanel, useAIActivity } from './AIActivityPanel';
import {
  Sparkle, PaperPlaneTilt, Plus, Star, Robot, Stack, Lightbulb, Clock, Eye, CheckCircle,
  BookOpen, Books, Coffee,
} from '@phosphor-icons/react';

const fallbackResponse: AdvisorResponse = {
mode: 'conversation',
analysis: 'AI 服务暂时不可用，请稍后重试。',
reply: 'AI 服务暂时不可用，请稍后重试。',
libraryMatches: [],
externalMatches: [],
};

interface AIAdvisorProps {
  books: Book[];
  onSelectBook: (book: Book) => void;
  onAddBook: (rec: Recommendation) => void;
}

interface ChatTurn {
  userRequest: string;
  mood?: ReadingMood | null;
  result: AdvisorResponse;
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

const roleConfig: Record<string, { label: string; icon: any; color: string; bg: string; border: string }> = {
  primary:           { label: '主书',   icon: BookOpen, color: 'text-accent-700',   bg: 'bg-accent-50',    border: 'border-accent-200' },
  complement:         { label: '补充',   icon: Books,    color: 'text-blue-700',     bg: 'bg-blue-50',      border: 'border-blue-200' },
  palate_cleanser:    { label: '放松',   icon: Coffee,   color: 'text-amber-700',    bg: 'bg-amber-50',     border: 'border-amber-200' },
};

export const AIAdvisor: React.FC<AIAdvisorProps> = ({ books, onSelectBook, onAddBook }) => {
  const storageKey = 'ai-advisor-chat';
  const [request, setRequest] = useState('');
  const [selectedMood, setSelectedMood] = useState<ReadingMood | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<ChatTurn[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ai = useAIActivity();

  // 持久化对话历史到 localStorage
  useEffect(() => {
    try {
      if (history.length > 0) {
        localStorage.setItem(storageKey, JSON.stringify(history.slice(-10)));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // localStorage 可能已满，忽略
    }
  }, [history, storageKey]);

  const handleConsult = async () => {
    if (!request.trim() && !selectedMood) return;
    const currentRequest = request.trim();
    const currentMood = selectedMood;

    setLoading(true);
    ai.reset();
    ai.startTimer();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const moodContext = currentMood
        ? `用户当前心境：${MOOD_OPTIONS.find(m => m.value === currentMood)?.label} - ${MOOD_OPTIONS.find(m => m.value === currentMood)?.description}。`
        : '';
      const fullRequest = moodContext + (currentRequest || MOOD_OPTIONS.find(m => m.value === currentMood)?.description || '');

      // 构建对话历史（传递完整上下文，让 AI 记住上次推荐了什么）
      const conversationHistory = history.flatMap(t => {
        const assistantContent = t.result.mode === 'conversation'
          ? (t.result.reply || '')
          : [
              t.result.analysis || '',
              t.result.recommendationStrategy || '',
              ...(t.result.libraryMatches || []).map(m => `书库推荐: 《${m.bookId}》(${m.role || 'unknown'}) - ${m.reason}`),
              ...(t.result.externalMatches || []).map(r => `外部推荐: 《${r.title}》-${r.author} (${r.role || 'unknown'}) - ${r.reason}`),
            ].join('\n');
        return [
          { role: 'user' as const, content: t.userRequest },
          { role: 'assistant' as const, content: assistantContent },
        ];
      });

      const data = await getRecommendationsStream(
        {
          userRequest: fullRequest,
          userMood: currentMood || undefined,
          library: books,
          conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
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
      // 确保对话模式有 reply，推荐模式有 analysis
      if (finalResult.mode === 'conversation' && !finalResult.reply) {
        finalResult.reply = finalResult.analysis || '';
      } else if (finalResult.mode === 'recommendation' && !finalResult.analysis) {
        finalResult.analysis = finalResult.reply || '';
      }

      setHistory(prev => [...prev, { userRequest: currentRequest, mood: currentMood, result: finalResult }]);
      setRequest('');
      setSelectedMood(null);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setHistory(prev => [...prev, { userRequest: currentRequest, mood: currentMood, result: fallbackResponse }]);
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
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [history, loading]);

  const getLibraryBook = (id: string) => books.find((b) => b.id === id);
  const isInitial = history.length === 0 && !loading;

  return (
    <div className="flex flex-col min-h-[calc(100dvh-8rem)] md:min-h-[calc(100dvh-4rem)] max-w-4xl mx-auto px-4 md:px-0">
      {/* Header */}
      <div className={`text-center transition-all duration-500 ${isInitial ? 'pt-12 md:pt-20' : 'pt-4 md:pt-6'}`}>
        <div className={`rounded-2xl bg-zinc-900 text-white flex items-center justify-center mx-auto mb-3 transition-all duration-500 ${isInitial ? 'w-14 h-14' : 'w-10 h-10'}`}>
          <Sparkle size={isInitial ? 28 : 20} weight="fill" />
        </div>
        <h2 className={`font-bold text-zinc-900 transition-all duration-300 ${isInitial ? 'text-2xl md:text-3xl' : 'text-lg'}`}>
          {isInitial ? '此刻你想读什么？' : 'AI 阅读顾问'}
        </h2>
        {isInitial && (
          <p className="text-zinc-500 text-sm mt-2 max-w-md mx-auto leading-relaxed">
            告诉我你的心境、目标或困惑。我会基于你的书库为你设计「主书 + 补充 + 放松」三层阅读组合——不只是推书，而是帮你规划这段时间的阅读路径。
          </p>
        )}
      </div>

      {/* 对话历史 */}
      <div className="flex-1 space-y-6 pt-4">
        {history.map((turn, turnIdx) => (
          <div key={turnIdx} className="space-y-4 animate-slide-up">
            {/* 用户消息 */}
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl bg-zinc-900 text-white px-4 py-2.5 text-sm">
                {turn.mood && (
                  <span className="mr-1.5">{MOOD_OPTIONS.find(m => m.value === turn.mood)?.emoji}</span>
                )}
                {turn.userRequest || MOOD_OPTIONS.find(m => m.value === turn.mood)?.label || '咨询'}
              </div>
            </div>

            {/* AI 回复 */}
            <AdvisorResult
              result={turn.result}
              getLibraryBook={getLibraryBook}
              onSelectBook={onSelectBook}
              onAddBook={onAddBook}
              onQuickReply={(text) => { setRequest(text); inputRef.current?.focus(); }}
            />
          </div>
        ))}

        {/* AI 活动面板 */}
        {loading && (
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
        )}
      </div>

      {/* 底部输入区 */}
      <div className="sticky bottom-0  backdrop-blur-md pt-4 pb-6 md:pb-8 -mx-4 px-4 md:mx-0 md:px-0">
        {/* 心境选择 */}
        <div className="flex flex-wrap gap-1.5 justify-center mb-3">
          {MOOD_OPTIONS.map((mood) => (
            <button
              key={mood.value}
              onClick={() => setSelectedMood(selectedMood === mood.value ? null : mood.value)}
              disabled={loading}
              className={[
                'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors duration-150',
                'active:scale-[0.97]',
                selectedMood === mood.value
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50',
                loading ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              <span className="mr-0.5">{mood.emoji}</span>
              {mood.label}
            </button>
          ))}
        </div>

        {/* 输入框 */}
        <div className="relative max-w-2xl mx-auto">
          <textarea
            ref={inputRef}
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder={history.length > 0 ? '继续追问…' : '例如：我想学 Rust，但不知道从哪里开始…'}
            className="w-full bg-white border border-zinc-200 rounded-xl resize-none text-sm text-zinc-900 placeholder:text-zinc-400 shadow-subtle p-4 pr-14 h-14"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleConsult(); } }}
            disabled={loading}
            rows={1}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Button
              onClick={handleConsult}
              isLoading={loading}
              disabled={!request.trim() && !selectedMood}
              size="sm"
              className="bg-zinc-900 hover:bg-zinc-800"
            >
              {loading ? '' : <PaperPlaneTilt size={16} weight="fill" />}
            </Button>
          </div>
        </div>
      </div>

      <div ref={bottomRef} />
    </div>
  );
};

// ============================================================================
// 结果展示组件
// ============================================================================
const AdvisorResult: React.FC<{
  result: AdvisorResponse;
  getLibraryBook: (id: string) => Book | undefined;
  onSelectBook: (book: Book) => void;
  onAddBook: (rec: Recommendation) => void;
  onQuickReply?: (text: string) => void;
}> = ({ result, getLibraryBook, onSelectBook, onAddBook, onQuickReply }) => {
  // 对话模式：简洁的聊天气泡
  if (result.mode === 'conversation' && result.reply) {
    return (
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-full bg-zinc-900 text-white flex items-center justify-center shrink-0">
          <Robot size={18} weight="fill" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="rounded-2xl bg-zinc-100 px-4 py-3">
            <p className="text-zinc-700 leading-relaxed text-[15px]">{result.reply}</p>
          </div>
          {result.suggestedQuestions && result.suggestedQuestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {result.suggestedQuestions.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => onQuickReply?.(q)}
                  className="px-2.5 py-1 rounded-full text-xs font-medium border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.97] transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 推荐模式：完整的推荐卡片
  return (
    <div className="space-y-4">
      {/* 顾问洞察 */}
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

      {/* 书库匹配 */}
      {result.libraryMatches.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Stack size={18} className="text-accent-600" />
            <h3 className="font-semibold text-zinc-900 text-sm">书库匹配</h3>
            <span className="badge bg-accent-50 text-accent-700">{result.libraryMatches.length} 本</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {result.libraryMatches.map((match, idx) => {
              const book = getLibraryBook(match.bookId);
              if (!book) return null;
              const role = match.role ? roleConfig[match.role] : null;
              return (
                <div
                  key={idx}
                  onClick={() => onSelectBook(book)}
                  className={`group cursor-pointer rounded-xl border bg-white p-4 hover:shadow-card-hover transition-[border-color,box-shadow] duration-200 ${role ? role.border : 'border-zinc-200 hover:border-zinc-300'}`}
                >
                  {role && (
                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold mb-2 ${role.bg} ${role.color}`}>
                      <role.icon size={11} weight="fill" /> {role.label}
                    </div>
                  )}
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
        </div>
      )}

      {/* 新书建议 */}
      {result.externalMatches.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkle size={18} className="text-zinc-900" />
            <h3 className="font-semibold text-zinc-900 text-sm">新书建议</h3>
            <span className="badge bg-zinc-100 text-zinc-600">{result.externalMatches.length} 本</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {result.externalMatches.map((rec, idx) => {
              const role = rec.role ? roleConfig[rec.role] : null;
              return (
              <div key={idx} className={`rounded-xl border bg-white p-4 flex flex-col hover:shadow-card-hover transition-[border-color,box-shadow] duration-200 ${role ? role.border : 'border-zinc-200 hover:border-zinc-300'}`}>
                {role && (
                  <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold mb-2 self-start ${role.bg} ${role.color}`}>
                    <role.icon size={11} weight="fill" /> {role.label}
                  </div>
                )}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
