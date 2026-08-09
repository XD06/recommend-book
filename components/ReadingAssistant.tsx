import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, UserProfile } from '../types';
import { readingAssistantStream, ChatMessage, ApiError } from '../services/geminiService';
import { useTypewriter } from '../hooks/useTypewriter';
import { AIActivityPanel, useAIActivity } from './AIActivityPanel';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  PaperPlaneTilt,
  Robot,
  User,
  Trash,
  ArrowClockwise,
  StopCircle,
  Books,
} from '@phosphor-icons/react';

interface ReadingAssistantProps {
  library: Book[];
  userProfile?: UserProfile;
  onBookUpdate?: (bookId: string, updates: Partial<Book>) => void;
}

const QUICK_QUESTIONS = [
  '我接下来该读什么？',
  '帮我分析一下我的阅读习惯',
  '书库里有哪些好书还没读？',
  '推荐一本适合碎片时间读的书',
];

export const ReadingAssistant: React.FC<ReadingAssistantProps> = ({ library, userProfile, onBookUpdate }) => {
  const storageKey = 'reading-assistant-chat';
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastFailedQuestion, setLastFailedQuestion] = useState<string | null>(null);
const typewriter = useTypewriter(2);
const ai = useAIActivity();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      if (messages.length > 0) {
        localStorage.setItem(storageKey, JSON.stringify(messages.slice(-20)));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // localStorage 可能已满，忽略
    }
  }, [messages, storageKey]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typewriter.displayedText]);

  const handleSend = async (questionText?: string) => {
    const question = (questionText || input).trim();
    if (!question || loading) return;

    setInput('');
    setLoading(true);
    setLastFailedQuestion(null);
    typewriter.reset();
    ai.reset();
    ai.startTimer();

    const controller = new AbortController();
    abortRef.current = controller;

    const userMsg: ChatMessage = { role: 'user', content: question };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    try {
      const reply = await readingAssistantStream(
        {
          question,
          library,
          conversationHistory: messages,
          userProfile,
        },
        {
          onChunk: (chunk) => typewriter.append(chunk),
          onPhase: (phase) => ai.handlePhase(phase),
          onToolCall: (toolName, label, round) => ai.handleToolCall(toolName, label, round),
          onReasoning: ai.handleReasoning,
          onBookUpdate: (bookId, updates) => {
            onBookUpdate?.(bookId, updates);
            window.dispatchEvent(new CustomEvent('aiBookUpdate', { detail: { bookId, updates } }));
          },
        },
        controller.signal,
      );

      typewriter.finish();
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      typewriter.reset();
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setMessages((prev) => prev.slice(0, -1));
      } else {
        const errMsg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '回答失败');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `抱歉，回答时出了点问题：${errMsg}` },
        ]);
        setLastFailedQuestion(question);
      }
      typewriter.reset();
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
    typewriter.reset();
    setMessages((prev) => prev.slice(0, -1));
  };

  const handleRetry = () => {
    if (!lastFailedQuestion) return;
    setMessages((prev) => prev.slice(0, -1));
    setLastFailedQuestion(null);
    handleSend(lastFailedQuestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    typewriter.reset();
    try { localStorage.removeItem(storageKey); } catch {}
  };

  return (
    <div className="flex flex-col h-[500px]">
      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 px-1 pb-2"
      >
        {/* 空状态 */}
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-accent-50 flex items-center justify-center mb-3">
              <Books size={24} className="text-accent-500" weight="fill" />
            </div>
            <p className="text-sm font-medium text-zinc-700 mb-1">阅读管家</p>
            <p className="text-xs text-zinc-400 mb-4 max-w-xs">
              我可以帮你管理书库、推荐书籍、分析阅读习惯，随时问我
            </p>
            {/* 快捷问题 */}
            <div className="flex flex-wrap gap-2 justify-center max-w-sm">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border border-zinc-200 bg-white text-zinc-600 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 transition-colors duration-150 active:scale-[0.97]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 消息气泡 */}
        <AnimatePresence>
          {messages.map((msg, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              {/* 头像 */}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === 'user'
                    ? 'bg-zinc-200 text-zinc-600'
                    : 'bg-zinc-900 text-white'
                }`}
              >
                {msg.role === 'user' ? (
                  <User size={14} weight="fill" />
                ) : (
                  <Robot size={14} weight="fill" />
                )}
              </div>
              {/* 气泡内容 */}
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-zinc-900 text-white rounded-tr-md'
                    : 'bg-zinc-100 text-zinc-700 rounded-tl-md'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <MarkdownRenderer content={msg.content} />
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* 流式回复 */}
        {loading && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-2.5"
          >
            <div className="w-7 h-7 rounded-full bg-zinc-900 text-white flex items-center justify-center shrink-0">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Robot size={14} weight="fill" />
              </motion.div>
            </div>
            <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-zinc-100 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-700">
              {typewriter.displayedText ? (
                <div>
                  <p className="whitespace-pre-wrap break-words">
                    {typewriter.displayedText}
                  </p>
                  <motion.span
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                    className="inline-block w-0.5 h-4 bg-accent-500 ml-0.5 align-middle rounded-full"
                  />
                  {/* 工具调用历史 + 计时 + 停止 */}
                  <div className="mt-2 pt-2 border-t border-zinc-200/60">
                    <AIActivityPanel
                      phase={ai.phase}
                      toolCalls={ai.toolCalls}
                      reasoningText={ai.reasoningText}
                      elapsedTime={ai.elapsedTime}
                      receivedChars={0}
                      onCancel={handleStop}
                      thinkingLabel="正在分析你的书库"
                      generatingLabel="正在生成回复"
                      compact
                    />
                  </div>
                </div>
              ) : (
                <AIActivityPanel
                  phase={ai.phase}
                  toolCalls={ai.toolCalls}
                  reasoningText={ai.reasoningText}
                  elapsedTime={ai.elapsedTime}
                  receivedChars={0}
                  onCancel={handleStop}
                  thinkingLabel="正在分析你的书库"
                  generatingLabel="正在生成回复"
                />
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* 输入栏 */}
      <div className="border-t border-zinc-100 pt-3 flex items-end gap-2">
        {messages.length > 0 && !loading && !lastFailedQuestion && (
          <button
            onClick={handleClear}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors shrink-0"
            title="清空对话"
          >
            <Trash size={15} />
          </button>
        )}
        {lastFailedQuestion && !loading && (
          <button
            onClick={handleRetry}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-accent-500 hover:text-accent-700 hover:bg-accent-50 transition-colors shrink-0"
            title="重试"
          >
            <ArrowClockwise size={15} />
          </button>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="问点什么...（如：我想找一本关于系统设计的书）"
          rows={1}
          className="flex-1 resize-none bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent-100 focus:border-accent-500 focus:bg-white transition-all max-h-24"
          style={{ minHeight: '40px' }}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || loading}
          className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center shrink-0 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-zinc-800 active:scale-95 transition-all"
        >
          <PaperPlaneTilt size={16} weight="fill" />
        </button>
      </div>
    </div>
  );
};
