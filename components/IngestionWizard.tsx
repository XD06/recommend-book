import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Warning, X, Sparkle, BookOpen } from '@phosphor-icons/react';
import { Button } from './Button';
import { Card, CardHeader, CardContent, CardFooter } from './Card';
import { Badge } from './Badge';
import { analyzeBookBatch, chunkArray, findBookByTitle } from '../services/geminiService';
import { Book } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface IngestionWizardProps {
  onComplete: (books: Book[]) => void;
  existingCategories: string[];
  onCancel?: () => void;
}

export const IngestionWizard: React.FC<IngestionWizardProps> = ({
  onComplete,
  existingCategories,
  onCancel,
}) => {
  const [rawText, setRawText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalBooks, setTotalBooks] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    const titles = rawText.split('\n').map((t) => t.trim()).filter((t) => t.length > 0);
    if (titles.length === 0) { setError('请至少输入一本书名。'); return; }
    setIsProcessing(true);
    setError(null);
    setTotalBooks(titles.length);
    setProgress(0);
    const batches = chunkArray<string>(titles, 10);
    let allBooks: Book[] = [];
    let processedCount = 0;
    try {
      for (const batch of batches) {
        try {
          // 1. AI 分类
          const analyzedBatch = await analyzeBookBatch(batch, existingCategories);
          
          // 2. 获取豆瓣信息（智能查找，缓存优先）
          const booksWithDouban: Book[] = await Promise.all(
            analyzedBatch.map(async (b) => {
              try {
                const result = await findBookByTitle(b.title || '');
                if (result && result.book) {
                  const doubanBook = result.book;
                  return {
                    ...b,
                    id: uuidv4(),
                    status: 'unread',
                    // 使用豆瓣数据补充
                    author: doubanBook.author?.join(', ') || b.author || '未知',
                    publisher: doubanBook.publisher || '',
                    // 封面使用代理格式
                    coverUrl: doubanBook.cover_url 
                      ? `https://douban-proxy.203065.xyz/?url=${encodeURIComponent(doubanBook.cover_url)}`
                      : undefined,
                    // 豆瓣评分
                    rating: doubanBook.rating_score,
                    pubDate: doubanBook.pubdate || doubanBook.publish_year,
                    isbn: doubanBook.isbn,
                    // 保存完整的豆瓣数据
                    doubanId: doubanBook.id,
                    doubanData: doubanBook,
                  } as Book;
                }
              } catch (e) {
                console.error('Douban find failed for:', b.title, e);
              }
              return { ...b, id: uuidv4(), status: 'unread' } as Book;
            })
          );
          
          allBooks = [...allBooks, ...booksWithDouban];
          processedCount += batch.length;
          setProgress(processedCount);
        } catch (err) {
          console.error('Batch failed', err);
        }
      }
      onComplete(allBooks);
    } catch {
      setError('处理过程中发生意外错误。');
    } finally {
      setIsProcessing(false);
    }
  };

  const loadExample = () => {
    setRawText(`深入理解计算机系统
设计模式：可复用面向对象软件的基础
代码大全
人月神话
黑客与画家
重构：改善既有代码的设计
程序员修炼之道
算法导论`);
  };

  const bookCount = rawText.split('\n').filter((t) => t.trim().length > 0).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      className="pt-20 pb-8"
    >
      <div className="max-w-2xl mx-auto">
        <AnimatePresence mode="wait">
          {!isProcessing ? (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Card>
                <CardHeader
                  title="导入书籍"
                  subtitle="粘贴书单，AI 自动整理分类"
                  action={
                    onCancel && (
                      <button
                        onClick={onCancel}
                        className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    )
                  }
                />
                <CardContent>
                  {/* Info Banner */}
                  <div className="flex items-start gap-3 p-3 bg-accent-50 rounded-lg border border-accent-100 mb-4">
                    <Sparkle className="w-4 h-4 text-accent-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-accent-800">
                      <p className="font-medium mb-0.5">AI 智能识别</p>
                      <p className="text-accent-700/80">
                        输入书名列表，AI 会自动获取书籍信息并分类。
                        {existingCategories.length > 0 && (
                          <span> 将优先匹配已有的 {existingCategories.length} 个分类。</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Text Input */}
                  <div className="relative">
                    <textarea
                      className="w-full h-64 p-4 rounded-xl border border-zinc-200 bg-zinc-50
                                 focus:bg-white focus:border-accent-500 focus:ring-2 focus:ring-accent-100
                                 resize-none font-mono text-sm text-zinc-900 placeholder:text-zinc-400
                                 outline-none transition-all duration-200"
                      placeholder="在此粘贴书名（每行一本）...&#10;例如：&#10;深入理解计算机系统&#10;设计模式&#10;代码大全"
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                    />
                    <button
                      onClick={loadExample}
                      className="absolute top-3 right-3 text-xs text-accent-600 hover:text-accent-700 font-medium px-2 py-1 bg-white rounded-md border border-zinc-200 hover:border-accent-200 transition-colors"
                    >
                      加载示例
                    </button>
                  </div>

                  {/* Error */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 p-3 rounded-lg bg-danger-50 border border-danger-100 text-danger-700 text-sm mt-3"
                    >
                      <Warning className="w-4 h-4 shrink-0" />
                      {error}
                    </motion.div>
                  )}

                  {/* Book Count */}
                  {bookCount > 0 && (
                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant="primary" dot>
                        检测到 {bookCount} 本书
                      </Badge>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button variant="ghost" onClick={onCancel}>
                    取消
                  </Button>
                  <Button
                    onClick={handleProcess}
                    disabled={!rawText.trim() || bookCount === 0}
                    leftIcon={<Sparkle className="w-4 h-4" />}
                  >
                    开始智能整理
                  </Button>
                </CardFooter>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="processing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center py-16"
            >
              <Card className="w-full max-w-md text-center">
                <CardContent className="pt-8">
                  {/* Animated Icon */}
                  <div className="relative w-20 h-20 mx-auto mb-6">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      className="absolute inset-0 rounded-full border-4 border-zinc-100 border-t-accent-500"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <BookOpen className="w-8 h-8 text-accent-600" weight="fill" />
                    </div>
                  </div>

                  <h3 className="text-lg font-semibold text-zinc-900 mb-2">
                    正在分析书籍...
                  </h3>
                  <p className="text-sm text-zinc-500 mb-6">
                    已处理 {progress} / {totalBooks} 本
                  </p>

                  {/* Progress Bar */}
                  <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
                    <motion.div
                      className="bg-accent-500 h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(progress / Math.max(totalBooks, 1)) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>

                  {/* Progress Details */}
                  <div className="mt-4 text-xs text-zinc-400">
                    正在获取书籍信息和分类...
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
