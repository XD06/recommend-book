import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, CategoryGroup, BookStatus, CategoryMeta, Recommendation } from './types';
import { IngestionWizard } from './components/IngestionWizard';
import { BookDetail } from './components/BookDetail';
import { LibraryView } from './components/LibraryView';
import { Navbar } from './components/Navbar';
import { AIAdvisor } from './components/AIAdvisor';
import { StatsView } from './components/StatsView';
import { DataManagement } from './components/DataManagement';
import { ToastProvider, useToast } from './components/Toast';
import { reorganizeLibrary } from './services/geminiService';
import { getInitialBooks } from './mock/data';
import { v4 as uuidv4 } from 'uuid';

// Hook for LocalStorage persistence
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch { return initialValue; }
  });
  const setValue = (value: T) => {
    try { setStoredValue(value); window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };
  return [storedValue, setValue];
}

// 内部组件，使用 useToast
const AppContent: React.FC = () => {
  const { showSuccess, showError, showInfo } = useToast();
  
  // 初始化为空书库，用户通过导入或添加来填充
  const [books, setBooks] = useLocalStorage<Book[]>('deepread_library', getInitialBooks());
  const [categoryMeta, setCategoryMeta] = useLocalStorage<Record<string, CategoryMeta>>('deepread_category_meta', {});

  // UI State
  const [activeTab, setActiveTab] = useState('library');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [showIngestion, setShowIngestion] = useState(false);

  // AI Loading State
  const [isReorganizing, setIsReorganizing] = useState(false);

  const categories = React.useMemo(() => {
    const groups: Record<string, number> = {};
    books.forEach((b) => { groups[b.category] = (groups[b.category] || 0) + 1; });
    return Object.entries(groups).map(([name, count]) => ({ name, count } as CategoryGroup));
  }, [books]);

  const handleIngestionComplete = (newBooks: Book[]) => {
    const existing = new Set(books.map((b) => b.title.toLowerCase().trim()));
    const unique = newBooks.filter((b) => !existing.has(b.title.toLowerCase().trim()));
    const duplicates = newBooks.length - unique.length;
    
    if (unique.length > 0) { 
      setBooks([...books, ...unique]); 
      showSuccess(`成功添加 ${unique.length} 本书${duplicates > 0 ? `，跳过 ${duplicates} 本重复` : ''}`);
    } else {
      showInfo('所有书籍已存在，未添加新书');
    }
    setShowIngestion(false);
    setActiveTab('library');
  };

  const handleBookUpdate = (updatedBook: Book) => {
    setBooks(books.map((b) => (b.id === updatedBook.id ? updatedBook : b)));
    setSelectedBook(updatedBook);
    showSuccess('书籍信息已更新');
  };

  // 监听 StatsView 中阅读时间线的书籍点击事件
  React.useEffect(() => {
    const handleOpenBookDetail = (e: CustomEvent<Book>) => {
      setSelectedBook(e.detail);
    };
    window.addEventListener('openBookDetail', handleOpenBookDetail as EventListener);
    return () => window.removeEventListener('openBookDetail', handleOpenBookDetail as EventListener);
  }, []);

  const handleAddRecommendation = (rec: Recommendation) => {
    if (books.some((b) => b.title.toLowerCase() === rec.title.toLowerCase())) { 
      alert('书库中已存在此书籍。'); 
      return; 
    }
    const now = new Date().toISOString();
    const newBook: Book = {
      id: uuidv4(), 
      title: rec.title, 
      author: rec.author, 
      publisher: rec.publisher,
      category: rec.category || '未分类', 
      subcategory: rec.subcategory || 'General',
      level: rec.level, 
      status: BookStatus.UNREAD, 
      coverColor: generateColor(rec.title), 
      rating: rec.rating,
      createdAt: now,
      updatedAt: now,
    };
    setBooks([...books, newBook]);
  };

  const handleReorganizeLibrary = async () => {
    if (!window.confirm('AI 将重新分配所有书籍的分类，确定继续吗？')) return;
    setIsReorganizing(true);
    try {
      const mapping = await reorganizeLibrary(books);
      setBooks(books.map((b) => { const u = mapping[b.id]; return u ? { ...b, category: u.category, subcategory: u.subcategory } : b; }));
      setCategoryMeta({});
    } catch (e: any) { 
      alert(`整理失败: ${e.message || '未知错误'}`); 
    }
    finally { setIsReorganizing(false); }
  };

  const handleExportData = () => {
    const data = { 
      meta: { 
        version: '2.0', 
        appName: 'DeepRead', 
        exportDate: new Date().toISOString(), 
        totalBooks: books.length 
      }, 
      data: { books, categoryMeta } 
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; 
    link.download = `DeepRead_Backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link); 
    URL.revokeObjectURL(url);
    showSuccess('数据导出成功');
  };

  const handleImportData = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (!parsed.data || !Array.isArray(parsed.data.books)) throw new Error('无效格式');
        if (window.confirm(`检测到 ${parsed.data.books.length} 本书。导入将覆盖当前数据，确认？`)) {
          setBooks(parsed.data.books); 
          setCategoryMeta(parsed.data.categoryMeta || {});
          setActiveTab('library');
          showSuccess(`成功导入 ${parsed.data.books.length} 本书`);
        }
      } catch { 
        showError('导入失败：文件格式错误'); 
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Navigation */}
      <Navbar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setShowIngestion(false);
        }}
        onImportClick={() => {
          setShowIngestion(true);
          setActiveTab('library');
        }}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 md:px-6">
        <AnimatePresence mode="wait">
          {showIngestion ? (
            <motion.div
              key="ingestion"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            >
              <IngestionWizard
                onComplete={handleIngestionComplete}
                existingCategories={categories.map((c) => c.name)}
                onCancel={() => setShowIngestion(false)}
              />
            </motion.div>
          ) : (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            >
              {activeTab === 'library' && (
                <LibraryView
                  books={books}
                  categories={categories}
                  onSelectBook={setSelectedBook}
                  onImportClick={() => setShowIngestion(true)}
                />
              )}
              {activeTab === 'advisor' && (
                <AIAdvisor
                  books={books}
                  onSelectBook={setSelectedBook}
                  onAddBook={handleAddRecommendation}
                />
              )}
              {activeTab === 'stats' && (
                <StatsView books={books} categories={categories} />
              )}
              {activeTab === 'settings' && (
                <DataManagement
                  onExport={handleExportData}
                  onImport={handleImportData}
                  stats={{
                    totalBooks: books.length,
                    categoriesCount: categories.length,
                    lastUpdated: new Date().toLocaleDateString(),
                  }}
                  onReorganize={handleReorganizeLibrary}
                  isReorganizing={isReorganizing}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Book Detail Modal */}
      <AnimatePresence>
        {selectedBook && (
          <BookDetail
            book={selectedBook}
            onClose={() => setSelectedBook(null)}
            onUpdate={handleBookUpdate}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// Generate a consistent color from string
function generateColor(str: string): string {
  const colors = [
    '#4f46e5', '#7c3aed', '#2563eb', '#0891b2', '#059669',
    '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// 包装组件，提供 ToastProvider
const App: React.FC = () => {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};

export default App;
