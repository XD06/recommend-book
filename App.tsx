import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { LoginPage } from './components/LoginPage';
import { reorganizeLibrary } from './services/geminiService';
import { fetchBooks, saveBooks, fetchCategoryMeta, saveCategoryMeta } from './services/bookService';
import { isLoggedIn, logout, fetchCurrentUser, AuthUser } from './services/authService';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// useBookLibrary — 替代 useLocalStorage 的 API 驱动书库管理
// ============================================================================

function useBookLibrary() {
  const [books, setBooksState] = useState<Book[]>([]);
  const [categoryMeta, setCategoryMetaState] = useState<Record<string, CategoryMeta>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoad = useRef(true);

  // 初始加载
  const loadFromAPI = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedBooks, fetchedMeta] = await Promise.all([
        fetchBooks(),
        fetchCategoryMeta(),
      ]);
      setBooksState(fetchedBooks);
      setCategoryMetaState(fetchedMeta);
    } catch (err: any) {
      setError(err.message || '加载数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 防抖保存书库到后端
  const setBooks = useCallback((newBooks: Book[]) => {
    setBooksState(newBooks);
    // 防抖：500ms 内不重复保存
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const saved = await saveBooks(newBooks);
        // 静默更新（可能后端做了数据清洗）
        setBooksState(saved);
      } catch (err: any) {
        console.error('[BookLibrary] 保存失败:', err.message);
      }
    }, 500);
  }, []);

  // 防抖保存分类元数据
  const setCategoryMeta = useCallback((newMeta: Record<string, CategoryMeta>) => {
    setCategoryMetaState(newMeta);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveCategoryMeta(newMeta);
      } catch (err: any) {
        console.error('[BookLibrary] 保存分类元数据失败:', err.message);
      }
    }, 500);
  }, []);

  return {
    books,
    categoryMeta,
    loading,
    error,
    setBooks,
    setCategoryMeta,
    loadFromAPI,
  };
}

// ============================================================================
// 主应用组件
// ============================================================================

const AppContent: React.FC<{ user: AuthUser; onLogout: () => void }> = ({ user, onLogout }) => {
  const { showSuccess, showError, showInfo } = useToast();
  const { books, categoryMeta, loading, error, setBooks, setCategoryMeta, loadFromAPI } = useBookLibrary();

  // UI State
  const [activeTab, setActiveTab] = useState('library');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [showIngestion, setShowIngestion] = useState(false);
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
        version: '3.0',
        appName: 'DeepRead',
        exportDate: new Date().toISOString(),
        totalBooks: books.length,
        user: user.username,
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

  // 加载状态
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
          <p className="text-sm text-zinc-500">加载书库中…</p>
        </div>
      </div>
    );
  }

  // 加载错误
  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => loadFromAPI()}
            className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-800"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50">
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
        user={user}
        onLogout={onLogout}
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

// ============================================================================
// 根组件 — 登录门控
// ============================================================================

const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // 启动时检查登录状态
  useEffect(() => {
    if (isLoggedIn()) {
      fetchCurrentUser().then((u) => {
        setUser(u);
        setAuthChecked(true);
      }).catch(() => {
        setAuthChecked(true);
      });
    } else {
      setAuthChecked(true);
    }
  }, []);

  const handleLogout = () => {
    logout();
    setUser(null);
  };

  // 等待 auth 检查完成
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  // 未登录 → 显示登录页
  if (!user) {
    return (
      <ToastProvider>
        <LoginPage onLogin={() => {
          // 登录成功后重新获取用户信息
          fetchCurrentUser().then(u => setUser(u));
        }} />
      </ToastProvider>
    );
  }

  // 已登录 → 显示主应用
  return (
    <ToastProvider>
      <AppContent user={user} onLogout={handleLogout} />
    </ToastProvider>
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

export default App;
