import React, { useState } from 'react';
import { Book, CategoryGroup, BookLevel, BookStatus, CategoryMeta, Recommendation } from './types';
import { IngestionWizard } from './components/IngestionWizard';
import { BookCard } from './components/BookCard';
import { BookDetail } from './components/BookDetail';
import { LibraryTable } from './components/LibraryTable';
import { Sidebar } from './components/Sidebar';
import { CategoryAdvisor } from './components/CategoryAdvisor';
import { LayoutGrid, Table2, Layers, Sparkles } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState('library'); // 'library', 'stats'
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
    const reading = books.filter(b => b.status === BookStatus.READING).length;
    const finished = books.filter(b => b.status === BookStatus.FINISHED).length;
    const unread = total - reading - finished;
    return { total, reading, finished, unread };
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
                 activeTab === 'library' ? '我的私人图书馆' : '阅读数据'}
              </h1>
              <p className="text-slate-500 mt-1">
                {showIngestion ? '批量粘贴书单，AI 自动整理' :
                 activeTab === 'library' ? `共藏书 ${stats.total} 本，正在阅读 ${stats.reading} 本` : '您的阅读习惯分析'}
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
          ) : activeTab === 'stats' ? (
             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Simple Stats Placeholder */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                   <h3 className="text-lg font-bold text-slate-700 mb-2">阅读完成率</h3>
                   <div className="text-4xl font-bold text-indigo-600">{stats.total ? Math.round((stats.finished / stats.total) * 100) : 0}%</div>
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