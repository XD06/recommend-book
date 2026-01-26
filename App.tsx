import React, { useState, useEffect } from 'react';
import { Book, CategoryGroup, BookLevel, BookStatus, CategoryMeta, Recommendation } from './types';
import { IngestionWizard } from './components/IngestionWizard';
import { BookCard } from './components/BookCard';
import { BookDetail } from './components/BookDetail';
import { LibraryTable } from './components/LibraryTable';
import { Library, LayoutGrid, Plus, BookOpen, Layers, Table2, BarChart3, Sparkles, ArrowRight, XCircle, GraduationCap } from 'lucide-react';
import { Button } from './components/Button';
import { generateReadingPath, recommendBooks, reorganizeLibrary } from './services/geminiService';
import { v4 as uuidv4 } from 'uuid';

// Hook for LocalStorage persistence
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
}

const App: React.FC = () => {
  // Data State
  const [books, setBooks] = useLocalStorage<Book[]>('deepread_library', []);
  const [categoryMeta, setCategoryMeta] = useLocalStorage<Record<string, CategoryMeta>>('deepread_category_meta', {});
  
  // UI State
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<BookLevel | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<BookStatus | 'All'>('All');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [showIngestion, setShowIngestion] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  
  // Recommendations State
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  
  // AI Loading State
  const [isGeneratingPath, setIsGeneratingPath] = useState(false);
  const [isReorganizing, setIsReorganizing] = useState(false);

  // Derive categories
  const categories = React.useMemo(() => {
    const groups: Record<string, number> = {};
    books.forEach(book => {
      groups[book.category] = (groups[book.category] || 0) + 1;
    });
    return Object.entries(groups).map(([name, count]) => ({ name, count } as CategoryGroup));
  }, [books]);

  // Statistics
  const stats = React.useMemo(() => {
    const total = books.length;
    const reading = books.filter(b => b.status === BookStatus.READING).length;
    const finished = books.filter(b => b.status === BookStatus.FINISHED).length;
    const unread = total - reading - finished;
    return { total, reading, finished, unread };
  }, [books]);

  // Handle ingestion with Deduplication
  const handleIngestionComplete = (newBooks: Book[]) => {
    const existingTitles = new Set(books.map(b => b.title.toLowerCase().trim()));
    const uniqueNewBooks = newBooks.filter(b => {
      const normalizedTitle = b.title.toLowerCase().trim();
      return !existingTitles.has(normalizedTitle);
    });

    if (uniqueNewBooks.length === 0) {
      alert("未发现新书籍，所有导入的书籍已存在于库中。");
    } else if (uniqueNewBooks.length < newBooks.length) {
      alert(`导入成功！自动过滤了 ${newBooks.length - uniqueNewBooks.length} 本重复书籍。`);
    }

    setBooks([...books, ...uniqueNewBooks]);
    setShowIngestion(false);
  };

  // Handle book update
  const handleBookUpdate = (updatedBook: Book) => {
    const newBooks = books.map(b => b.id === updatedBook.id ? updatedBook : b);
    setBooks(newBooks);
    setSelectedBook(updatedBook); 
  };

  // Handle book delete
  const handleDeleteBook = (id: string) => {
    if (window.confirm('确定要删除这本书吗？')) {
       const bookToDelete = books.find(b => b.id === id);
       setBooks(books.filter(b => b.id !== id));
       
       if (selectedBook?.id === id) setSelectedBook(null);

       if (bookToDelete && categoryMeta[bookToDelete.category]) {
         const meta = categoryMeta[bookToDelete.category];
         if (meta.path) {
           const newPath = meta.path.filter(pathId => pathId !== id);
           setCategoryMeta({
             ...categoryMeta,
             [bookToDelete.category]: { ...meta, path: newPath }
           });
         }
       }
    }
  };

  // Handle Library Reorganization
  const handleReorganizeLibrary = async () => {
    if (books.length === 0) return;
    if (!window.confirm("确定要让 AI 重新规划所有书籍的分类吗？\n\nAI 将合并相似的领域（如 'CS' 和 '计算机'），但不会修改书名或状态。")) {
      return;
    }

    setIsReorganizing(true);
    try {
      const mapping = await reorganizeLibrary(books);
      
      // Data Integrity Check
      const returnedIds = Object.keys(mapping);
      if (returnedIds.length !== books.length) {
        throw new Error(`数据安全检查未通过：发送 ${books.length} 本，AI 返回 ${returnedIds.length} 本。操作已取消以保护数据。`);
      }

      // Apply changes
      let changedCount = 0;
      const newBooks = books.map(book => {
        const newCategory = mapping[book.id];
        if (newCategory && newCategory !== book.category) {
          changedCount++;
          return { ...book, category: newCategory };
        }
        return book;
      });

      if (changedCount > 0) {
        setBooks(newBooks);
        // Reset path metadata as categories have changed
        setCategoryMeta({});
        alert(`重组完成！已优化 ${changedCount} 本书籍的分类归属。`);
      } else {
        alert("分类结构已经很完美了，无需调整。");
      }

    } catch (e: any) {
      alert(`重组失败: ${e.message || "未知错误"}`);
    } finally {
      setIsReorganizing(false);
    }
  };

  // AI Generate Path
  const handleGeneratePath = async () => {
    if (!selectedCategory) return;
    setIsGeneratingPath(true);
    try {
      const categoryBooks = books.filter(b => b.category === selectedCategory);
      const result = await generateReadingPath(categoryBooks, selectedCategory);
      
      setCategoryMeta({
        ...categoryMeta,
        [selectedCategory]: {
          path: result.sortedBookIds,
          pathReasoning: result.reasoning,
          lastUpdated: new Date().toISOString()
        }
      });

    } catch (e) {
      alert("生成阅读路径失败，请稍后重试");
    } finally {
      setIsGeneratingPath(false);
    }
  };

  // AI Recommendation
  const handleGetRecommendations = async () => {
    if (!selectedCategory) return;
    setIsRecommending(true);
    try {
      const categoryBooks = books.filter(b => b.category === selectedCategory);
      const recs = await recommendBooks(categoryBooks, selectedCategory);
      setRecommendations(recs);
    } catch (e) {
      alert("AI 推荐失败，请稍后重试");
    } finally {
      setIsRecommending(false);
    }
  };

  const handleAddRecommendation = (rec: Recommendation) => {
    // Check if already exists
    const exists = books.some(b => b.title.toLowerCase() === rec.title.toLowerCase());
    if (exists) {
      alert("书库中已存在此书籍。");
      return;
    }

    const newBook: Book = {
      id: uuidv4(),
      title: rec.title,
      author: rec.author,
      category: selectedCategory || '未分类',
      level: rec.level,
      status: BookStatus.UNREAD
    };

    setBooks([...books, newBook]);
    // Remove from current recommendations view
    setRecommendations(prev => prev ? prev.filter(r => r.title !== rec.title) : null);
  };

  // Filtering Logic
  const filteredBooks = React.useMemo(() => {
    let result = books.filter(book => {
      if (selectedCategory && book.category !== selectedCategory) return false;
      if (selectedLevel !== 'All' && book.level !== selectedLevel) return false;
      if (statusFilter !== 'All' && book.status !== statusFilter) return false;
      return true;
    });

    if (selectedCategory && categoryMeta[selectedCategory]?.path) {
      const pathIds = categoryMeta[selectedCategory].path || [];
      result.sort((a, b) => {
        const indexA = pathIds.indexOf(a.id);
        const indexB = pathIds.indexOf(b.id);
        const rankA = indexA === -1 ? 9999 : indexA;
        const rankB = indexB === -1 ? 9999 : indexB;
        return rankA - rankB;
      });
    }

    return result;
  }, [books, selectedCategory, selectedLevel, statusFilter, categoryMeta]);

  const handleStatusFilterClick = (status: BookStatus | 'All') => {
    if (statusFilter === status) {
      setStatusFilter('All');
    } else {
      setStatusFilter(status);
      setSelectedCategory(null); 
      setViewMode('table'); 
    }
  };

  const levelLabels = {
    'All': '全部',
    [BookLevel.BASIC]: '基础',
    [BookLevel.ADVANCED]: '进阶',
    [BookLevel.EXPERT]: '专家'
  };

  const currentMeta = selectedCategory ? categoryMeta[selectedCategory] : null;

  // Derive existing category names for ingestion context
  const existingCategoryNames = React.useMemo(() => categories.map(c => c.name), [categories]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Navbar */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer group" onClick={() => { setSelectedCategory(null); setShowIngestion(false); setViewMode('grid'); setStatusFilter('All'); }}>
            <div className="bg-indigo-600 group-hover:bg-indigo-700 transition-colors p-1.5 rounded-lg text-white">
              <Library size={20} />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">DeepRead</h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden md:flex bg-slate-100/80 p-1 rounded-lg border border-slate-200">
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                title="网格视图"
              >
                <LayoutGrid size={18} />
              </button>
              <button 
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                title="列表管理"
              >
                <Table2 size={18} />
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowIngestion(true)} className="shadow-sm">
              <Plus size={16} className="mr-2" /> 添加书籍
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Stats Bar */}
        {!showIngestion && books.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
             <div 
               onClick={() => handleStatusFilterClick('All')}
               className={`p-4 rounded-xl border shadow-sm flex flex-col cursor-pointer transition-all hover:scale-[1.02] active:scale-95 ${statusFilter === 'All' ? 'bg-slate-800 border-slate-800 text-white ring-2 ring-offset-2 ring-slate-800' : 'bg-white border-slate-200 hover:border-slate-300'}`}
             >
               <span className={`text-xs font-bold uppercase tracking-wider mb-1 ${statusFilter === 'All' ? 'text-slate-400' : 'text-slate-500'}`}>总藏书</span>
               <span className={`text-3xl font-bold ${statusFilter === 'All' ? 'text-white' : 'text-slate-900'}`}>{stats.total}</span>
             </div>
             
             <div 
               onClick={() => handleStatusFilterClick(BookStatus.UNREAD)}
               className={`p-4 rounded-xl border shadow-sm flex flex-col cursor-pointer transition-all hover:scale-[1.02] active:scale-95 ${statusFilter === BookStatus.UNREAD ? 'bg-slate-800 border-slate-800 ring-2 ring-offset-2 ring-slate-800' : 'bg-white border-slate-200 hover:border-slate-300'}`}
             >
               <span className={`text-xs font-bold uppercase tracking-wider mb-1 ${statusFilter === BookStatus.UNREAD ? 'text-slate-400' : 'text-slate-500'}`}>待阅读</span>
               <span className={`text-3xl font-bold ${statusFilter === BookStatus.UNREAD ? 'text-white' : 'text-slate-400'}`}>{stats.unread}</span>
             </div>
             
             <div 
               onClick={() => handleStatusFilterClick(BookStatus.READING)}
               className={`p-4 rounded-xl border shadow-sm flex flex-col cursor-pointer transition-all hover:scale-[1.02] active:scale-95 ${statusFilter === BookStatus.READING ? 'bg-indigo-600 border-indigo-600 ring-2 ring-offset-2 ring-indigo-600' : 'bg-white border-slate-200 hover:border-slate-300'}`}
             >
               <span className={`text-xs font-bold uppercase tracking-wider mb-1 ${statusFilter === BookStatus.READING ? 'text-indigo-200' : 'text-slate-500'}`}>阅读中</span>
               <span className={`text-3xl font-bold ${statusFilter === BookStatus.READING ? 'text-white' : 'text-indigo-600'}`}>{stats.reading}</span>
             </div>
             
             <div 
               onClick={() => handleStatusFilterClick(BookStatus.FINISHED)}
               className={`p-4 rounded-xl border shadow-sm flex flex-col cursor-pointer transition-all hover:scale-[1.02] active:scale-95 ${statusFilter === BookStatus.FINISHED ? 'bg-emerald-600 border-emerald-600 ring-2 ring-offset-2 ring-emerald-600' : 'bg-white border-slate-200 hover:border-slate-300'}`}
             >
               <span className={`text-xs font-bold uppercase tracking-wider mb-1 ${statusFilter === BookStatus.FINISHED ? 'text-emerald-200' : 'text-slate-500'}`}>已读完</span>
               <span className={`text-3xl font-bold ${statusFilter === BookStatus.FINISHED ? 'text-white' : 'text-emerald-600'}`}>{stats.finished}</span>
             </div>
          </div>
        )}

        {/* State: No Books */}
        {books.length === 0 && !showIngestion ? (
          <div className="text-center py-20 animate-in fade-in zoom-in-95 duration-500">
            <h2 className="text-3xl font-extrabold text-slate-900 mb-4 tracking-tight">开始您的深度阅读之旅</h2>
            <p className="text-slate-500 mb-8 max-w-md mx-auto leading-relaxed">请导入您的书单。DeepSeek AI 将自动为您分析、分类并构建结构化的知识体系。</p>
            <Button size="lg" onClick={() => setShowIngestion(true)} className="shadow-lg shadow-indigo-200">
              <Plus className="mr-2" size={20} /> 导入书库
            </Button>
          </div>
        ) : showIngestion ? (
          /* State: Ingestion Wizard */
          <>
             <div className="mb-6 flex items-center">
                <button onClick={() => setShowIngestion(false)} className="text-slate-500 hover:text-indigo-600 text-sm font-medium transition-colors">
                  &larr; 返回书库
                </button>
             </div>
             <IngestionWizard 
               onComplete={handleIngestionComplete} 
               existingCategories={existingCategoryNames}
             />
          </>
        ) : viewMode === 'table' ? (
          /* State: Table Management View */
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
             <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-bold text-slate-900 flex items-center">
                    <Table2 className="mr-3 text-indigo-600" /> 书库管理
                  </h2>
                  {statusFilter !== 'All' && (
                     <span className="px-3 py-1 bg-slate-100 rounded-full text-sm font-medium text-slate-600 flex items-center border border-slate-200">
                       {statusFilter === BookStatus.UNREAD ? '未读' : statusFilter === BookStatus.READING ? '阅读中' : '已完成'}
                       <button onClick={() => setStatusFilter('All')} className="ml-2 hover:text-red-500"><XCircle size={14} /></button>
                     </span>
                  )}
                </div>
             </div>
             <LibraryTable 
                books={filteredBooks} 
                onDelete={handleDeleteBook}
                onReorganize={handleReorganizeLibrary}
                isReorganizing={isReorganizing}
             />
          </div>
        ) : (
          /* State: Dashboard (Grid View) */
          <div className="space-y-8">
            
            {/* 1. Category Discovery */}
            {!selectedCategory && statusFilter === 'All' ? (
              <div className="animate-in fade-in duration-300">
                <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center">
                  <LayoutGrid size={20} className="mr-2 text-indigo-600" /> 按领域探索
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {categories.map((cat) => (
                    <div 
                      key={cat.name}
                      onClick={() => setSelectedCategory(cat.name)}
                      className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-200 hover:-translate-y-1 cursor-pointer transition-all group duration-200"
                    >
                      <h3 className="font-bold text-slate-800 text-lg group-hover:text-indigo-600 transition-colors">{cat.name}</h3>
                      <p className="text-slate-500 text-sm mt-2 font-medium bg-slate-50 inline-block px-2 py-0.5 rounded-md">{cat.count} 本书</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* 2. Book List View */
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                       <button 
                        onClick={() => { setSelectedCategory(null); setStatusFilter('All'); }}
                        className="text-slate-500 hover:text-indigo-600 hover:bg-slate-100 px-2 py-1 -ml-2 rounded text-sm flex items-center transition-colors font-medium"
                      >
                        <Layers size={14} className="mr-1" /> {statusFilter !== 'All' ? '返回全局' : '所有领域'}
                      </button>
                      <span className="text-slate-300">/</span>
                      <span className="text-indigo-600 font-bold text-sm">
                        {selectedCategory || (statusFilter === BookStatus.READING ? '阅读中' : statusFilter === BookStatus.FINISHED ? '已完成' : '待阅读')}
                      </span>
                    </div>
                    
                    <h2 className="text-3xl font-extrabold text-slate-900 mb-2 tracking-tight">{selectedCategory || '筛选结果'}</h2>
                    
                    {/* Path Reasoning Display */}
                    {selectedCategory && currentMeta?.pathReasoning && (
                      <div className="mt-4 bg-gradient-to-r from-indigo-50 to-white border border-indigo-100 p-5 rounded-xl shadow-sm">
                        <h4 className="flex items-center text-indigo-900 font-bold text-sm mb-2">
                          <Sparkles size={16} className="mr-2 text-indigo-600" /> 
                          AI 学习路径规划
                        </h4>
                        <p className="text-indigo-800/80 text-sm leading-relaxed">{currentMeta.pathReasoning}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-3 items-end w-full md:w-auto">
                    {/* Action Buttons */}
                    {selectedCategory && statusFilter === 'All' && (
                       <div className="flex gap-2 w-full md:w-auto">
                          {/* Suggest Books */}
                          <Button 
                             variant="outline" 
                             size="sm"
                             onClick={handleGetRecommendations}
                             isLoading={isRecommending}
                             className="flex-1 md:flex-none"
                          >
                             <GraduationCap size={16} className="mr-2" /> 补充经典
                          </Button>

                          {/* Generate Path */}
                          {!currentMeta?.path && (
                            <Button 
                              variant="secondary" 
                              size="sm" 
                              onClick={handleGeneratePath} 
                              isLoading={isGeneratingPath}
                              className="shadow-sm flex-1 md:flex-none"
                            >
                              <Sparkles size={16} className="mr-2" /> 生成学习路径
                            </Button>
                          )}
                       </div>
                    )}

                    {/* Difficulty Filter Tabs */}
                    <div className="bg-white p-1 rounded-lg border border-slate-200 inline-flex w-full md:w-auto justify-between md:justify-start">
                      {([
                        'All',
                        BookLevel.BASIC,
                        BookLevel.ADVANCED,
                        BookLevel.EXPERT
                      ] as const).map(level => (
                        <button
                          key={level}
                          onClick={() => setSelectedLevel(level)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                            selectedLevel === level 
                            ? 'bg-slate-800 text-white shadow-sm' 
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {levelLabels[level]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {filteredBooks.length === 0 ? (
                  <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-slate-400 font-medium">该筛选条件下暂无书籍</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                    {filteredBooks.map((book, index) => (
                      <div key={book.id} className="relative group perspective-1000">
                         {/* Ordering Badge */}
                         {selectedCategory && currentMeta?.path && statusFilter === 'All' && (
                           <div className="absolute -top-3 -left-3 w-8 h-8 bg-slate-900 text-white rounded-xl flex items-center justify-center font-bold shadow-lg z-10 border-2 border-slate-50 transform group-hover:-translate-y-1 transition-transform">
                             {(currentMeta.path.indexOf(book.id) !== -1) ? currentMeta.path.indexOf(book.id) + 1 : '+'}
                           </div>
                         )}
                         <BookCard 
                           book={book} 
                           onClick={() => setSelectedBook(book)} 
                         />
                         {selectedCategory && currentMeta?.path && statusFilter === 'All' && index < filteredBooks.length - 1 && (
                           <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2 z-0 text-slate-300">
                             <ArrowRight size={24} />
                           </div>
                         )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Book Detail Modal */}
      {selectedBook && (
        <BookDetail 
          book={selectedBook} 
          onClose={() => setSelectedBook(null)} 
          onUpdate={handleBookUpdate}
        />
      )}

      {/* Recommendations Modal */}
      {recommendations && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
           <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
                <div>
                   <h3 className="text-xl font-bold text-slate-900 flex items-center">
                     <GraduationCap className="mr-2 text-indigo-600" /> 推荐补充经典
                   </h3>
                   <p className="text-sm text-slate-500 mt-1">AI 认为您的书库可以补充以下权威著作</p>
                </div>
                <button onClick={() => setRecommendations(null)} className="p-2 hover:bg-slate-200 rounded-full text-slate-400">
                  <XCircle size={24} />
                </button>
              </div>
              <div className="overflow-y-auto p-6 space-y-4 bg-slate-50/30">
                 {recommendations.length === 0 && <p className="text-center text-slate-500">暂时没有更多推荐。</p>}
                 {recommendations.map((rec, i) => (
                    <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row gap-4 items-start md:items-center">
                       <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                             <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                rec.level === 'Basic' ? 'bg-green-100 text-green-800' :
                                rec.level === 'Advanced' ? 'bg-yellow-100 text-yellow-800' : 
                                'bg-red-100 text-red-800'
                              }`}>
                                {rec.level === 'Basic' ? '基础' : rec.level === 'Advanced' ? '进阶' : '专家'}
                             </span>
                          </div>
                          <h4 className="font-bold text-lg text-slate-900">{rec.title}</h4>
                          <p className="text-sm text-slate-600 mb-2">{rec.author}</p>
                          <p className="text-xs text-indigo-700 bg-indigo-50 p-2 rounded-lg leading-relaxed">
                             <span className="font-bold mr-1">推荐理由:</span>{rec.reason}
                          </p>
                       </div>
                       <Button size="sm" onClick={() => handleAddRecommendation(rec)} className="shrink-0">
                          <Plus size={16} className="mr-1" /> 加入书库
                       </Button>
                    </div>
                 ))}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;