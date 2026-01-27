import React, { useState } from 'react';
import { Book, BookStatus, AIInsight, BookLevel } from '../types';
import { X, Play, BookOpen, BrainCircuit, Lightbulb, Target, CheckCircle2, Edit3, Save, RotateCcw, Building2, Tag } from 'lucide-react';
import { Button } from './Button';
import { generateBookInsight } from '../services/geminiService';

interface BookDetailProps {
  book: Book;
  onClose: () => void;
  onUpdate: (updatedBook: Book) => void;
}

export const BookDetail: React.FC<BookDetailProps> = ({ book, onClose, onUpdate }) => {
  const [isActivating, setIsActivating] = useState(false);
  const [activeTab, setActiveTab] = useState<'insight' | 'progress'>('insight');
  
  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(book.title);
  const [editAuthor, setEditAuthor] = useState(book.author);
  const [editPublisher, setEditPublisher] = useState(book.publisher || '');
  const [editCategory, setEditCategory] = useState(book.category);
  const [editSubcategory, setEditSubcategory] = useState(book.subcategory || '');
  const [editLevel, setEditLevel] = useState<BookLevel>(book.level);

  // Progress State
  const [totalPagesInput, setTotalPagesInput] = useState(book.userData?.totalPages?.toString() || '');
  const [currentPageInput, setCurrentPageInput] = useState(book.userData?.currentPage?.toString() || '');
  const [percentageInput, setPercentageInput] = useState(book.userData?.progressPercentage?.toString() || '');

  const levelText = {
    [BookLevel.BASIC]: '基础',
    [BookLevel.ADVANCED]: '进阶',
    [BookLevel.EXPERT]: '专家',
  };

  const handleSaveEdit = () => {
    const updatedBook: Book = {
      ...book,
      title: editTitle,
      author: editAuthor,
      publisher: editPublisher,
      category: editCategory,
      subcategory: editSubcategory,
      level: editLevel
    };
    onUpdate(updatedBook);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(book.title);
    setEditAuthor(book.author);
    setEditPublisher(book.publisher || '');
    setEditCategory(book.category);
    setEditSubcategory(book.subcategory || '');
    setEditLevel(book.level);
    setIsEditing(false);
  };

  const handleStartReading = async () => {
    setIsActivating(true);
    try {
      const insight = await generateBookInsight(book.title, book.author, book.level);
      const updatedBook: Book = {
        ...book,
        status: BookStatus.READING,
        aiInsight: insight,
        userData: {
          totalPages: parseInt(totalPagesInput) || 300, // Default if not provided
          currentPage: 0,
          progressPercentage: 0,
          startDate: new Date().toISOString()
        }
      };
      onUpdate(updatedBook);
    } catch (e) {
      console.error(e);
      // Fallback if AI fails: still start reading but without insight
      const updatedBook: Book = {
         ...book,
         status: BookStatus.READING,
         userData: {
           totalPages: parseInt(totalPagesInput) || 300,
           currentPage: 0,
           progressPercentage: 0,
           startDate: new Date().toISOString()
         }
       };
       onUpdate(updatedBook);
    } finally {
      setIsActivating(false);
    }
  };

  const updateProgress = (type: 'page' | 'percent') => {
    if (!book.userData) return;
    
    let newCurrent = book.userData.currentPage;
    let newPercent = book.userData.progressPercentage;
    const total = book.userData.totalPages;

    if (type === 'page') {
      newCurrent = Math.min(parseInt(currentPageInput) || 0, total);
      newPercent = (newCurrent / total) * 100;
    } else {
      newPercent = Math.min(parseFloat(percentageInput) || 0, 100);
      newCurrent = Math.round((newPercent / 100) * total);
    }

    const isFinished = newPercent >= 100;
    
    onUpdate({
      ...book,
      status: isFinished ? BookStatus.FINISHED : BookStatus.READING,
      userData: {
        ...book.userData,
        currentPage: newCurrent,
        progressPercentage: newPercent,
        completionDate: isFinished ? new Date().toISOString() : undefined
      }
    });

    // Sync inputs
    setCurrentPageInput(newCurrent.toString());
    setPercentageInput(newPercent.toFixed(1));
  };

  const isUnread = book.status === BookStatus.UNREAD;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header Section */}
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <div className="flex justify-between items-start">
             {/* Edit Mode Inputs or Display Mode */}
             <div className="flex-1 mr-4 space-y-3">
               {isEditing ? (
                 <div className="space-y-3 animate-in fade-in">
                   <input 
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full text-xl font-bold p-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                      placeholder="书名"
                   />
                   <div className="grid grid-cols-2 gap-2">
                     <input 
                        value={editAuthor}
                        onChange={(e) => setEditAuthor(e.target.value)}
                        className="w-full text-sm p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="作者"
                     />
                     <input 
                        value={editPublisher}
                        onChange={(e) => setEditPublisher(e.target.value)}
                        className="w-full text-sm p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="出版社 (选填)"
                     />
                   </div>
                   <div className="flex gap-2">
                     <input 
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="flex-1 text-xs p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="一级分类"
                     />
                     <input 
                        value={editSubcategory}
                        onChange={(e) => setEditSubcategory(e.target.value)}
                        className="flex-1 text-xs p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="二级分类"
                     />
                     <select
                        value={editLevel}
                        onChange={(e) => setEditLevel(e.target.value as BookLevel)}
                        className="text-xs p-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                     >
                        <option value={BookLevel.BASIC}>基础</option>
                        <option value={BookLevel.ADVANCED}>进阶</option>
                        <option value={BookLevel.EXPERT}>专家</option>
                     </select>
                   </div>
                   <div className="flex gap-2 mt-2">
                      <Button size="sm" onClick={handleSaveEdit} className="gap-1">
                        <Save size={14} /> 保存
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleCancelEdit} className="gap-1">
                        <RotateCcw size={14} /> 取消
                      </Button>
                   </div>
                 </div>
               ) : (
                 <>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-200 px-2 py-0.5 rounded">
                      {book.category}
                    </span>
                    {book.subcategory && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded flex items-center">
                        <Tag size={10} className="mr-1" />
                        {book.subcategory}
                      </span>
                    )}
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                      book.level === 'Basic' ? 'bg-green-100 text-green-800' :
                      book.level === 'Advanced' ? 'bg-yellow-100 text-yellow-800' : 
                      'bg-red-100 text-red-800'
                    }`}>
                      {levelText[book.level]}
                    </span>
                    <button 
                      onClick={() => setIsEditing(true)} 
                      className="text-slate-400 hover:text-indigo-600 transition-colors p-1 rounded hover:bg-slate-100"
                      title="编辑信息"
                    >
                      <Edit3 size={14} />
                    </button>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 leading-tight">{book.title}</h2>
                  <div className="flex flex-col gap-1 mt-1">
                    <p className="text-lg text-slate-600">{book.author}</p>
                    {book.publisher && (
                      <p className="text-xs text-slate-400 flex items-center">
                        <Building2 size={12} className="mr-1" /> {book.publisher}
                      </p>
                    )}
                  </div>
                 </>
               )}
             </div>

             <button onClick={onClose} className="p-2 -mr-2 -mt-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600">
               <X size={24} />
             </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 p-6">
          
          {/* Activation State (Unread) */}
          {isUnread && (
            <div className="text-center py-8 space-y-6">
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-100 to-violet-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <BrainCircuit size={32} />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">解锁 AI 深度解读</h3>
                <p className="text-slate-500 mb-6 text-sm">
                  DeepRead 将为您生成个性化简介、基于难度的阅读策略建议以及核心章节梳理。
                </p>
                <div className="flex flex-col items-center gap-4 bg-slate-50 p-6 rounded-xl border border-slate-100">
                  <div className="w-full max-w-xs">
                    <label className="block text-xs font-medium text-slate-500 mb-1 text-left">书籍总页数</label>
                    <input 
                      type="number" 
                      value={totalPagesInput}
                      onChange={(e) => setTotalPagesInput(e.target.value)}
                      placeholder="例如: 320"
                      className="w-full p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                    />
                  </div>
                  <Button 
                    onClick={handleStartReading} 
                    isLoading={isActivating}
                    disabled={!totalPagesInput}
                    size="lg"
                    className="w-full max-w-xs shadow-md shadow-indigo-200"
                  >
                    <Play size={18} className="mr-2" /> 开始阅读
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Active/Finished State */}
          {!isUnread && (
            <div className="space-y-8">
              {/* Tabs */}
              <div className="flex border-b border-slate-200">
                <button 
                  onClick={() => setActiveTab('insight')}
                  className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'insight' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  AI 解读
                </button>
                <button 
                  onClick={() => setActiveTab('progress')}
                  className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'progress' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                  进度追踪
                </button>
              </div>

              {activeTab === 'insight' && book.aiInsight && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="bg-slate-50 p-5 rounded-xl border border-slate-100">
                    <h4 className="flex items-center text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">
                      <BookOpen size={14} className="mr-2 text-indigo-500" /> 简介
                    </h4>
                    <p className="text-slate-700 leading-relaxed text-sm text-justify">{book.aiInsight.summary}</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-amber-50 p-5 rounded-xl border border-amber-100/50">
                      <h4 className="flex items-center text-xs font-bold text-amber-800/70 mb-3 uppercase tracking-wider">
                        <Lightbulb size={14} className="mr-2" /> 阅读建议
                      </h4>
                      <p className="text-amber-900 text-sm leading-relaxed">{book.aiInsight.advice}</p>
                    </div>
                    <div className="bg-blue-50 p-5 rounded-xl border border-blue-100/50">
                      <h4 className="flex items-center text-xs font-bold text-blue-800/70 mb-3 uppercase tracking-wider">
                        <Target size={14} className="mr-2" /> 核心章节
                      </h4>
                      <ul className="space-y-2">
                        {book.aiInsight.keyChapters.map((chapter, i) => (
                          <li key={i} className="flex items-start text-sm text-blue-900">
                            <span className="mr-2 mt-1.5 w-1 h-1 bg-blue-500 rounded-full flex-shrink-0" />
                            {chapter}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'progress' && book.userData && (
                <div className="space-y-6 animate-in fade-in">
                   <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 rounded-2xl shadow-lg shadow-slate-200">
                      <div>
                        <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">当前进度</p>
                        <div className="text-4xl font-bold tracking-tight">
                          {Math.round(book.userData.progressPercentage)}%
                        </div>
                      </div>
                      <div className="text-right">
                         <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">页码</p>
                         <div className="text-2xl font-semibold">
                           {book.userData.currentPage} <span className="text-slate-500 text-lg font-normal">/ {book.userData.totalPages}</span>
                         </div>
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 border border-slate-200 rounded-xl hover:border-indigo-200 transition-colors">
                        <label className="block text-xs font-medium text-slate-500 mb-2">按页码更新</label>
                        <div className="flex gap-2">
                          <input 
                            type="number" 
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                            value={currentPageInput}
                            onChange={(e) => setCurrentPageInput(e.target.value)}
                          />
                          <Button size="sm" onClick={() => updateProgress('page')}>更新</Button>
                        </div>
                      </div>
                      <div className="p-4 border border-slate-200 rounded-xl hover:border-indigo-200 transition-colors">
                        <label className="block text-xs font-medium text-slate-500 mb-2">按百分比更新</label>
                        <div className="flex gap-2">
                          <input 
                            type="number" 
                            className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                            value={percentageInput}
                            onChange={(e) => setPercentageInput(e.target.value)}
                          />
                          <Button size="sm" onClick={() => updateProgress('percent')}>更新</Button>
                        </div>
                      </div>
                   </div>

                   {book.status === BookStatus.FINISHED && (
                     <div className="flex items-center justify-center p-4 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100">
                        <CheckCircle2 className="mr-2" /> 阅读完成于 {new Date(book.userData.completionDate || '').toLocaleDateString()}
                     </div>
                   )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};