import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from './Button';
import { analyzeBookBatch, chunkArray } from '../services/geminiService';
import { Book } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface IngestionWizardProps {
  onComplete: (books: Book[]) => void;
  existingCategories: string[];
}

export const IngestionWizard: React.FC<IngestionWizardProps> = ({ onComplete, existingCategories }) => {
  const [rawText, setRawText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalBooks, setTotalBooks] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    const titles = rawText.split('\n').map(t => t.trim()).filter(t => t.length > 0);
    if (titles.length === 0) {
      setError("请至少输入一本书名。");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setTotalBooks(titles.length);
    setProgress(0);

    const batches = chunkArray<string>(titles, 10); // Process 10 books at a time
    let allBooks: Book[] = [];
    let processedCount = 0;

    try {
      for (const batch of batches) {
        try {
          // Pass existingCategories to the AI service
          const analyzedBatch = await analyzeBookBatch(batch, existingCategories);
          
          // Ensure IDs are present
          const cleanBatch: Book[] = analyzedBatch.map(b => ({
            ...b,
            id: uuidv4(),
            status: 'unread'
          } as Book));
          
          allBooks = [...allBooks, ...cleanBatch];
          processedCount += batch.length;
          setProgress(processedCount);
        } catch (err) {
          console.error("Batch failed", err);
          // Continue with other batches, but log error (in a real app, maybe retry)
        }
      }
      onComplete(allBooks);
    } catch (err) {
      setError("处理过程中发生意外错误。");
    } finally {
      setIsProcessing(false);
    }
  };

  const loadExample = () => {
    setRawText(`The Pragmatic Programmer
Sapiens: A Brief History of Humankind
Atomic Habits
Thinking, Fast and Slow
Clean Code
The Great Gatsby
1984
Dune`);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 mb-4">
          <Upload size={24} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">导入您的书库</h2>
        <p className="text-slate-500 mt-2">在下方粘贴您的书单（每行一本），DeepSeek AI 将自动为您整理。</p>
        {existingCategories.length > 0 && (
          <p className="text-xs text-indigo-600 mt-2 bg-indigo-50 inline-block px-3 py-1 rounded-full">
            AI 将优先匹配您已有的 {existingCategories.length} 个分类
          </p>
        )}
      </div>

      {!isProcessing ? (
        <div className="space-y-4">
          <div className="relative">
            <textarea
              className="w-full h-64 p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none font-mono text-sm"
              placeholder="在此粘贴书名（每行一本）..."
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
            <button 
              onClick={loadExample}
              className="absolute top-4 right-4 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
            >
              加载示例
            </button>
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg flex items-center text-sm">
              <AlertCircle size={16} className="mr-2" />
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleProcess} disabled={!rawText.trim()}>
              开始智能整理
            </Button>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center space-y-6">
          <div className="relative w-24 h-24 mx-auto">
             <svg className="animate-spin w-full h-full text-indigo-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">DeepSeek 正在分析您的书籍...</h3>
            <p className="text-slate-500">已处理 {progress} / {totalBooks} 本</p>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div 
              className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" 
              style={{ width: `${(progress / Math.max(totalBooks, 1)) * 100}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
};