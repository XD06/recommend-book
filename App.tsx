import React, { useState } from 'react';
import { Book, CategoryGroup, BookLevel, BookStatus, CategoryMeta, Recommendation } from './types';
import { IngestionWizard } from './components/IngestionWizard';
import { BookCard } from './components/BookCard';
import { BookDetail } from './components/BookDetail';
import { LibraryTable } from './components/LibraryTable';
import { Sidebar } from './components/Sidebar';
import { CategoryAdvisor } from './components/CategoryAdvisor';
import { DataManagement } from './components/DataManagement';
import { LayoutGrid, Table2, Layers, Sparkles, BookOpen, CheckCircle2, Clock, BarChart3, TrendingUp, Trophy } from 'lucide-react';
import { Button } from './components/Button';
import { generateReadingPath, reorganizeLibrary } from './services/geminiService';
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
  const [activeTab, setActiveTab] = useState('library'); // 'library', 'stats', 'settings'
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<BookLevel | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<BookStatus | 'All'>('All');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [showIngestion, setShowIngestion] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  
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
    const readingBooks = books.filter(b => b.status === BookStatus.READING);
    const reading = readingBooks.length;
    const finished = books.filter(b => b.status === BookStatus.FINISHED).length;
    const unread = total - reading - finished;
    
    // Calculate pages
    let totalPagesRead = 0;
    books.forEach(b => {
      if (b.userData) {
        if (b.status === BookStatus.FINISHED) {
          totalPagesRead += b.userData.totalPages;
        } else {
          totalPagesRead += b.userData.currentPage;
        }
      }
    });

    // Level distribution
    const levels = {
      [BookLevel.BASIC]: books.filter(b => b.level === BookLevel.BASIC).length,
      [BookLevel.ADVANCED]: books.filter(b => b.level === BookLevel.ADVANCED).length,
      [BookLevel.EXPERT]: books.filter(b => b.level === BookLevel.EXPERT).length,
    };

    return { total, reading, finished, unread, totalPagesRead, readingBooks, levels };
  }, [books]);

  // Handle ingestion
  const handleIngestionComplete = (newBooks: Book[]) => {
    const existingTitles = new Set(books.map(b => b.title.toLowerCase().trim()));
    const uniqueNewBooks = newBooks.filter(b => {
      const normalizedTitle = b.title.toLowerCase().trim();
      return !existingTitles.has(normalizedTitle);
    });

    if (uniqueNewBooks.length > 0) {
      setBooks([...books, ...uniqueNewBooks]);
      alert(`成功导入 ${uniqueNewBooks.length} 本书。`);
    } else {
      alert("没有发现新书（可能全是重复的）。");
    }
    setShowIngestion(false);
    setActiveTab('library');
  };

  // Handle updates
  const handleBookUpdate = (updatedBook: Book) => {
    const newBooks = books.map(b => b.id === updatedBook.id ? updatedBook : b);
    setBooks(newBooks);
    setSelectedBook(updatedBook); 
  };

  const handleDeleteBook = (id: string) => {
    if (window.confirm('确定要删除这本书吗？')) {
       setBooks(books.filter(b => b.id !== id));
       if (selectedBook?.id === id) setSelectedBook(null);
    }
  };

  // Add from recommendation
  const handleAddRecommendation = (rec: Recommendation) => {
    const exists = books.some(b => b.title.toLowerCase() === rec.title.toLowerCase());
    if (exists) {
      alert("书库中已存在此书籍。");
      return;
    }
    const newBook: Book = {
      id: uuidv4(),
      title: rec.title,
      author: rec.author,
      publisher: rec.publisher,
      category: selectedCategory || (rec.level === 'Basic' ? '入门推荐' : '进阶阅读'),
      level: rec.level,
      status: BookStatus.UNREAD
    };
    setBooks([...books, newBook]);
    alert(`已将《${rec.title}》添加到书库！`);
  };

  // AI Actions
  const handleReorganizeLibrary = async () => {
    if (!window.confirm("确定要 AI 重新归类吗？")) return;
    setIsReorganizing(true);
    try {
      const mapping = await reorganizeLibrary(books);
      const newBooks = books.map(book => mapping[book.id] ? { ...book, category: mapping[book.id] } : book);
      setBooks(newBooks);
      setCategoryMeta({}); // Clear metadata on restructure
      alert("整理完成！");
    } catch (e) {
      alert("整理失败，请重试。");
    } finally {
      setIsReorganizing(false);
    }
  };

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
      alert("生成路径失败");
    } finally {
      setIsGeneratingPath(false);
    }
  };

  // Backup & Restore Handlers
  const handleExportData = () => {
    const backupData = {
      meta: {
        version: '1.0',
        appName: 'DeepRead MVP',
        exportDate: new Date().toISOString(),
        totalBooks: books.length
      },
      data: {
        books: books,
        categoryMeta: categoryMeta
      }
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `DeepRead_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportData = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);

        // Basic validation structure
        if (!parsed.data || !Array.isArray(parsed.data.books)) {
          throw new Error('无效的备份文件格式');
        }

        const confirmMsg = `
检测到有效备份文件：
📅 导出时间：${new Date(parsed.meta?.exportDate || Date.now()).toLocaleString()}
📚 书籍数量：${parsed.data.books.length} 本

警告：导入将覆盖当前所有数据，此操作不可撤销！
是否确认恢复？`;

        if (window.confirm(confirmMsg)) {
          setBooks(parsed.data.books);
          setCategoryMeta(parsed.data.categoryMeta || {});
          alert('✅ 数据已成功恢复！');
          setActiveTab('library');
        }
      } catch (err) {
        console.error(err);
        alert('❌ 导入失败：文件格式错误或数据损坏');
      }
    };
    reader.readAsText(file);
  };

  // Filter Logic
  const filteredBooks = React.useMemo(() => {
    let result = books.filter(book => {
      if (selectedCategory && book.category !== selectedCategory) return false;
      if (selectedLevel !== 'All' && book.level !== selectedLevel) return false;
      if (statusFilter !== 'All' && book.status !== statusFilter) return false;
      return true;
    });
    // Apply path sorting if exists
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

  const currentMeta = selectedCategory ? categoryMeta[selectedCategory] : null;

  return (
    <div className="min-h-screen bg-stone-50 font-sans flex">
      {/* Sidebar Navigation */}
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={(tab) => { setActiveTab(tab); setShowIngestion(false); }}
        onImportClick={() => { setShowIngestion(true); setActiveTab('library'); }}
      />

      {/* Main Content Area */}
      <div className="flex-1 ml-20 md:ml-64 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 py-8">
          
          {/* Header Area (Dynamic) */}
          <header className="mb-8 flex justify-between items-end">
            <div>
              <h1 className="text-3xl font-serif font-bold text-slate-900">
                {showIngestion ? '导入书籍' : 
                 activeTab === 'library' ? '我的私人图书馆' : 
                 activeTab === 'stats' ? '阅读数据中心' : '数据管理'}
              </h1>
              <p className="text-slate-500 mt-1">
                {showIngestion ? '批量粘贴书单，AI 自动整理' :
                 activeTab === 'library' ? `共藏书 ${stats.total} 本，正在阅读 ${stats.reading} 本` :
                 activeTab === 'stats' ? '全方位分析您的阅读习惯' : '备份与迁移您的个人数据'}
              </p>
            </div>
            
            {activeTab === 'library' && !showIngestion && (
              <div className="flex bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                 <button onClick={() => setViewMode('grid')} className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400'}`}><LayoutGrid size={18} /></button>
                 <button onClick={() => setViewMode('table')} className={`p-2 rounded-md ${viewMode === 'table' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400'}`}><Table2 size={18} /></button>
              </div>
            )}
          </header>

          {/* Main Content Switcher */}
          {showIngestion ? (
             <IngestionWizard 
               onComplete={handleIngestionComplete} 
               existingCategories={categories.map(c => c.name)}
             />
          ) : activeTab === 'settings' ? (
             <DataManagement 
               onExport={handleExportData} 
               onImport={handleImportData}
               stats={{
                 totalBooks: books.length,
                 categoriesCount: categories.length,
                 lastUpdated: new Date().toLocaleDateString()
               }}
             />
          ) : activeTab === 'stats' ? (
             <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* 1. Key Metrics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start justify-between">
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">正在阅读</p>
                      <h3 className="text-3xl font-bold text-indigo-600">{stats.reading}</h3>
                      <p className="text-xs text-slate-400 mt-2">书本进行中</p>
                    </div>
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Clock size={20} />
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start justify-between">
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">已读完</p>
                      <h3 className="text-3xl font-bold text-emerald-600">{stats.finished}</h3>
                      <p className="text-xs text-slate-400 mt-2">获得成就感</p>
                    </div>
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                      <CheckCircle2 size={20} />
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start justify-between">
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">累计阅读页数</p>
                      <h3 className="text-3xl font-bold text-amber-600">{stats.totalPagesRead.toLocaleString()}</h3>
                      <p className="text-xs text-slate-400 mt-2">知识的厚度</p>
                    </div>
                    <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                      <BookOpen size={20} />
                    </div>
                  </div>

                   <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start justify-between">
                    <div>
                      <p className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">藏书总数</p>
                      <h3 className="text-3xl font-bold text-slate-700">{stats.total}</h3>
                      <p className="text-xs text-slate-400 mt-2">待探索 {stats.unread} 本</p>
                    </div>
                    <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
                      <Layers size={20} />
                    </div>
                  </div>
                </div>

                {/* 2. Currently Reading List */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center">
                      <TrendingUp size={20} className="mr-2 text-indigo-500" /> 
                      正在阅读 ({stats.reading})
                    </h3>
                    
                    {stats.readingBooks.length === 0 ? (
                      <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                        <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                          <BookOpen size={24} />
                        </div>
                        <h4 className="text-slate-600 font-medium mb-2">当前没有正在阅读的书籍</h4>
                        <p className="text-slate-400 text-sm mb-4">从书库中挑选一本，开始您的深度阅读之旅吧。</p>
                        <Button onClick={() => setActiveTab('library')}>去书库选书</Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {stats.readingBooks.map(book => (
                          <div key={book.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-5 items-center sm:items-stretch">
                            {/* Visual Cover Placeholder */}
                            <div className={`w-16 h-24 shrink-0 rounded shadow-md bg-gradient-to-br ${
                              book.level === BookLevel.BASIC ? 'from-emerald-600 to-teal-800' :
                              book.level === BookLevel.ADVANCED ? 'from-blue-700 to-indigo-900' : 'from-red-800 to-rose-950'
                            } flex items-center justify-center text-white/20 font-serif font-bold`}>
                              {book.level[0]}
                            </div>
                            
                            <div className="flex-1 w-full">
                              <div className="flex justify-between items-start mb-1">
                                <h4 className="font-serif font-bold text-lg text-slate-900">{book.title}</h4>
                                <span className="text-2xl font-bold text-indigo-600">{Math.round(book.userData?.progressPercentage || 0)}%</span>
                              </div>
                              <p className="text-sm text-slate-500 mb-4">{book.author}</p>
                              
                              <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden mb-2">
                                <div 
                                  className="bg-indigo-600 h-full rounded-full transition-all duration-500" 
                                  style={{ width: `${book.userData?.progressPercentage || 0}%` }}
                                ></div>
                              </div>
                              
                              <div className="flex justify-between items-center text-xs text-slate-400">
                                <span>
                                  {book.userData?.currentPage || 0} / {book.userData?.totalPages || '?'} 页
                                </span>
                                {book.userData?.totalPages && book.userData.currentPage < book.userData.totalPages && (
                                  <span>剩余 {book.userData.totalPages - book.userData.currentPage} 页</span>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex sm:flex-col justify-center gap-2 w-full sm:w-auto mt-2 sm:mt-0 border-t sm:border-t-0 sm:border-l border-slate-100 pt-3 sm:pt-0 sm:pl-4">
                              <Button size="sm" onClick={() => setSelectedBook(book)} className="w-full sm:w-24">更新进度</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 3. Stats & Distribution */}
                  <div className="space-y-6">
                    {/* Difficulty Distribution */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                       <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-6 flex items-center">
                         <BarChart3 size={16} className="mr-2" /> 藏书难度分布
                       </h3>
                       <div className="space-y-5">
                         {[
                           { label: '入门 (Basic)', count: stats.levels[BookLevel.BASIC], color: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
                           { label: '进阶 (Advanced)', count: stats.levels[BookLevel.ADVANCED], color: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-700' },
                           { label: '专家 (Expert)', count: stats.levels[BookLevel.EXPERT], color: 'bg-rose-500', bg: 'bg-rose-50', text: 'text-rose-700' },
                         ].map((item) => (
                           <div key={item.label}>
                             <div className="flex justify-between text-xs font-medium mb-1.5">
                               <span className={item.text}>{item.label}</span>
                               <span className="text-slate-400">{item.count} 本</span>
                             </div>
                             <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                               <div 
                                 className={`h-full ${item.color} rounded-full transition-all duration-500`}
                                 style={{ width: `${stats.total ? (item.count / stats.total * 100) : 0}%` }}
                               ></div>
                             </div>
                           </div>
                         ))}
                       </div>
                    </div>

                    {/* Top Categories */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                       <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center">
                         <Trophy size={16} className="mr-2" /> 热门分类
                       </h3>
                       <div className="space-y-3">
                         {categories.sort((a, b) => b.count - a.count).slice(0, 5).map((cat, idx) => (
                           <div key={cat.name} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                             <div className="flex items-center gap-3">
                               <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                 idx === 0 ? 'bg-yellow-100 text-yellow-700' : 
                                 idx === 1 ? 'bg-slate-200 text-slate-600' :
                                 idx === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-400'
                               }`}>
                                 {idx + 1}
                               </span>
                               <span className="text-sm font-medium text-slate-700">{cat.name}</span>
                             </div>
                             <span className="text-xs font-bold text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm">
                               {cat.count}
                             </span>
                           </div>
                         ))}
                         {categories.length === 0 && <p className="text-sm text-slate-400 text-center py-4">暂无分类数据</p>}
                       </div>
                    </div>
                  </div>
                </div>
             </div>
          ) : (
            /* LIBRARY VIEW */
            <div className="space-y-6">
               {/* Filters */}
               <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm sticky top-4 z-20">
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full">
                     <button 
                       onClick={() => { setSelectedCategory(null); setStatusFilter('All'); }}
                       className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${!selectedCategory && statusFilter === 'All' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                     >
                       <Layers size={14} className="inline mr-1" /> 全部
                     </button>
                     {categories.map(cat => (
                       <button
                         key={cat.name}
                         onClick={() => { setSelectedCategory(cat.name); setStatusFilter('All'); }}
                         className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${selectedCategory === cat.name ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                       >
                         {cat.name} <span className="opacity-60 text-xs ml-1">{cat.count}</span>
                       </button>
                     ))}
                  </div>
                  
                  <div className="w-px h-6 bg-slate-200 mx-2 hidden md:block"></div>
                  
                  <div className="flex gap-1 ml-auto">
                    {(['All', BookLevel.BASIC, BookLevel.ADVANCED, BookLevel.EXPERT] as const).map(lvl => (
                      <button 
                        key={lvl}
                        onClick={() => setSelectedLevel(lvl)}
                        className={`text-xs px-2 py-1 rounded ${selectedLevel === lvl ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                      >
                        {lvl === 'All' ? '全难度' : lvl}
                      </button>
                    ))}
                  </div>
               </div>

               {/* NEW: Contextual AI Advisor (Only appears when a category is selected) */}
               {selectedCategory && (
                  <CategoryAdvisor 
                    category={selectedCategory} 
                    books={filteredBooks}
                    onAddBook={handleAddRecommendation}
                  />
               )}

               {/* Path Info Banner */}
               {selectedCategory && currentMeta?.pathReasoning && (
                  <div className="bg-gradient-to-r from-indigo-50 to-white border border-indigo-100 p-5 rounded-xl shadow-sm animate-in fade-in">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="flex items-center text-indigo-900 font-bold text-sm mb-2">
                          <Sparkles size={16} className="mr-2 text-indigo-600" /> 
                          AI 学习路径规划
                        </h4>
                        <p className="text-indigo-800/80 text-sm leading-relaxed max-w-3xl">{currentMeta.pathReasoning}</p>
                      </div>
                      {!currentMeta.path && (
                         <Button size="sm" variant="secondary" onClick={handleGeneratePath} isLoading={isGeneratingPath}>生成路径</Button>
                      )}
                    </div>
                  </div>
               )}

               {/* Content */}
               {viewMode === 'table' ? (
                 <LibraryTable 
                    books={filteredBooks} 
                    onDelete={handleDeleteBook} 
                    onReorganize={handleReorganizeLibrary}
                    isReorganizing={isReorganizing}
                 />
               ) : (
                 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-10 pb-20 px-2">
                    {filteredBooks.map((book, idx) => (
                      <div key={book.id} className="relative group">
                         {selectedCategory && currentMeta?.path && (
                           <div className="absolute -top-4 -left-2 z-10 w-8 h-8 bg-slate-900 text-white rounded-full flex items-center justify-center font-bold text-sm border-2 border-stone-50 shadow-md">
                             {(currentMeta.path.indexOf(book.id) !== -1) ? currentMeta.path.indexOf(book.id) + 1 : '-'}
                           </div>
                         )}
                         <BookCard book={book} onClick={() => setSelectedBook(book)} />
                      </div>
                    ))}
                    {filteredBooks.length === 0 && (
                      <div className="col-span-full text-center py-20 text-slate-400">
                        <p>没有找到相关书籍</p>
                        <Button variant="outline" className="mt-4" onClick={() => setSelectedCategory(null)}>清除筛选</Button>
                      </div>
                    )}
                 </div>
               )}

               {/* Context Actions for Category - Only show path gen if not already shown */}
               {selectedCategory && !currentMeta?.path && filteredBooks.length > 2 && viewMode === 'grid' && !currentMeta?.pathReasoning && (
                 <div className="fixed bottom-8 right-8 animate-in slide-in-from-bottom-4 z-30">
                   <Button onClick={handleGeneratePath} isLoading={isGeneratingPath} className="shadow-xl shadow-indigo-900/20">
                     <Sparkles size={16} className="mr-2" /> 为当前分类生成学习路径
                   </Button>
                 </div>
               )}
            </div>
          )}
        </div>
      </div>

      {/* Book Detail Modal */}
      {selectedBook && (
        <BookDetail 
          book={selectedBook} 
          onClose={() => setSelectedBook(null)} 
          onUpdate={handleBookUpdate}
        />
      )}
    </div>
  );
};

export default App;