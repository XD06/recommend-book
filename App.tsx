import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, CategoryGroup, BookStatus, CategoryMeta, Recommendation, UserProfile } from './types';
import { IngestionWizard } from './components/IngestionWizard';
import { BookDetail } from './components/BookDetail';
import { LibraryView } from './components/LibraryView';
import { Navbar } from './components/Navbar';
import { AIAdvisor } from './components/AIAdvisor';
import { StatsView } from './components/StatsView';
import { DataManagement } from './components/DataManagement';
import { ToastProvider, useToast } from './components/Toast';
import { ConfirmProvider, useConfirm } from './components/ConfirmDialog';
import { LoginPage } from './components/LoginPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { reorganizeLibrary } from './services/geminiService';
import { fetchBooks, saveBooks, fetchCategoryMeta, saveCategoryMeta, fetchProfile, saveProfile } from './services/bookService';
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
  const saveBooksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoad = useRef(true);

  // 初始加载（含一次性 localStorage → SQLite 迁移）
  const loadFromAPI = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. 先尝试从后端加载
      const [fetchedBooks, fetchedMeta] = await Promise.all([
        fetchBooks(),
        fetchCategoryMeta(),
      ]);

      // 2. 一次性迁移：如果后端书库为空，但 localStorage 有旧数据，自动上传
      const MIGRATED_KEY = 'deepread_migrated_to_db';
      if (fetchedBooks.length === 0 && !localStorage.getItem(MIGRATED_KEY)) {
        try {
          const oldBooksRaw = localStorage.getItem('deepread_library');
          const oldMetaRaw = localStorage.getItem('deepread_category_meta');
          if (oldBooksRaw) {
            const oldBooks = JSON.parse(oldBooksRaw) as Book[];
            if (oldBooks.length > 0) {
              console.log(`[迁移] 检测到 localStorage 中 ${oldBooks.length} 本旧书，正在迁移到数据库…`);
              const savedBooks = await saveBooks(oldBooks);
              setBooksState(savedBooks);
              if (oldMetaRaw) {
                const oldMeta = JSON.parse(oldMetaRaw);
                setCategoryMetaState(oldMeta);
                await saveCategoryMeta(oldMeta);
              }
              console.log('[迁移] 迁移完成！');
              // 标记已迁移，不再重复执行
              localStorage.setItem(MIGRATED_KEY, 'true');
              setLoading(false);
              return;
            }
          }
        } catch (migrateErr: any) {
          console.error('[迁移] 失败:', migrateErr.message);
        }
        // 即使没有旧数据，也标记为已迁移
        localStorage.setItem(MIGRATED_KEY, 'true');
      }

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
    // 防抖：500ms 内不重复保存（独立 timer，不与分类元数据共享）
    if (saveBooksTimerRef.current) clearTimeout(saveBooksTimerRef.current);
    saveBooksTimerRef.current = setTimeout(async () => {
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
    if (saveMetaTimerRef.current) clearTimeout(saveMetaTimerRef.current);
    saveMetaTimerRef.current = setTimeout(async () => {
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
  const { confirm } = useConfirm();
  const { books, categoryMeta, loading, error, setBooks, setCategoryMeta, loadFromAPI } = useBookLibrary();

  // UI State
  const [activeTab, setActiveTab] = useState('library');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [showIngestion, setShowIngestion] = useState(false);
  const [isReorganizing, setIsReorganizing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>(new Date().toLocaleDateString());

  // 组件挂载时从后端加载书库数据
  useEffect(() => {
    loadFromAPI();
  }, [loadFromAPI]);

  // 用户画像：AI 推荐的个性化输入。不加载则 aiService 的【用户画像】段恒空、
  // get_user_profile 工具恒返回"用户尚未设置画像信息"
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((p) => { if (!cancelled) setUserProfile(p); })
      .catch((err) => console.warn('[Profile] 画像加载失败，推荐将以无画像模式运行:', err.message));
    return () => { cancelled = true; };
  }, []);

  const handleSaveProfile = async (profile: UserProfile) => {
    try {
      setUserProfile(await saveProfile(profile));
      showSuccess('阅读画像已保存');
    } catch (e: any) {
      showError(`保存画像失败: ${e.message || '未知错误'}`);
    }
  };

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
      setLastUpdated(new Date().toLocaleDateString());
      showSuccess(`成功添加 ${unique.length} 本书${duplicates > 0 ? `，跳过 ${duplicates} 本重复` : ''}`);
    } else {
      showInfo('所有书籍已存在，未添加新书');
    }
    setShowIngestion(false);
    setActiveTab('library');
  };

  const handleBookUpdate = (updatedBook: Book, silent = false) => {
    setBooks(books.map((b) => (b.id === updatedBook.id ? updatedBook : b)));
    setSelectedBook(updatedBook);
    if (!silent) showSuccess('书籍信息已更新');
  };

  React.useEffect(() => {
    const handleOpenBookDetail = (e: CustomEvent<Book>) => {
      setSelectedBook(e.detail);
    };
    window.addEventListener('openBookDetail', handleOpenBookDetail as EventListener);
    return () => window.removeEventListener('openBookDetail', handleOpenBookDetail as EventListener);
  }, []);

  // AI 写工具（update_book_status）的落地端：后端只发 SSE 事件，真正改数据的是这里
  useEffect(() => {
    const handleAIBookUpdate = (e: CustomEvent<{ bookId: string; updates: Partial<Book> }>) => {
      const { bookId, updates } = e.detail;
      const target = books.find((b) => b.id === bookId);
      if (!target) return;
      const merged = { ...target, ...updates, updatedAt: new Date().toISOString() };
      setBooks(books.map((b) => (b.id === bookId ? merged : b)));
      setSelectedBook((prev) => (prev && prev.id === bookId ? { ...prev, ...updates } : prev));
      showInfo('AI 已更新书籍状态');
    };
    window.addEventListener('aiBookUpdate', handleAIBookUpdate as EventListener);
    return () => window.removeEventListener('aiBookUpdate', handleAIBookUpdate as EventListener);
  }, [books, setBooks, showInfo]);

  const handleAddRecommendation = (rec: Recommendation) => {
    if (books.some((b) => b.title.toLowerCase() === rec.title.toLowerCase())) {
      showError('书库中已存在此书籍');
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
    const ok = await confirm({
      title: 'AI 智能整理',
      message: 'AI 将重新分配所有书籍的分类，此操作会修改现有分类结构。确定继续吗？',
      confirmLabel: '开始整理',
    });
    if (!ok) return;
    setIsReorganizing(true);
    try {
      const mapping = await reorganizeLibrary(books);
      setBooks(books.map((b) => { const u = mapping[b.id]; return u ? { ...b, category: u.category, subcategory: u.subcategory } : b; }));
      setCategoryMeta({});
      setLastUpdated(new Date().toLocaleDateString());
      showSuccess('书库整理完成');
    } catch (e: any) {
      showError(`整理失败: ${e.message || '未知错误'}`);
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
    reader.onload = async (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (!parsed.data || !Array.isArray(parsed.data.books)) throw new Error('无效格式');
        const ok = await confirm({
          title: '导入数据',
          message: `检测到 ${parsed.data.books.length} 本书。导入将覆盖当前数据，确认？`,
          confirmLabel: '覆盖导入',
          variant: 'danger',
        });
        if (ok) {
          setBooks(parsed.data.books);
          setCategoryMeta(parsed.data.categoryMeta || {});
          setActiveTab('library');
          setLastUpdated(new Date().toLocaleDateString());
          showSuccess(`成功导入 ${parsed.data.books.length} 本书`);
        }
      } catch {
        showError('导入失败：文件格式错误');
      }
    };
    reader.readAsText(file);
  };

  const handleClearAllData = async () => {
    const ok = await confirm({
      title: '清除所有数据',
      message: '确定要清除所有数据吗？此操作无法撤销。建议先导出备份。',
      confirmLabel: '清除所有数据',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      // 清除后端数据（发送空数组删除所有书）
      await saveBooks([]);
      setBooks([]);
      setCategoryMeta({});
      localStorage.clear();
      showSuccess('所有数据已清除');
      window.location.reload();
    } catch (e: any) {
      showError(`清除失败: ${e.message || '未知错误'}`);
    }
  };

  // 加载状态
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
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
        books={books}
        onSelectBook={setSelectedBook}
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
                  userProfile={userProfile ?? undefined}
                  onSelectBook={setSelectedBook}
                  onAddBook={handleAddRecommendation}
                />
              )}
              {activeTab === 'stats' && (
                <StatsView
                  books={books}
                  userProfile={userProfile ?? undefined}
                  onSelectBook={setSelectedBook}
                />
              )}
              {activeTab === 'settings' && (
                <DataManagement
                  onExport={handleExportData}
                  onImport={handleImportData}
                  onClearAll={handleClearAllData}
                  stats={{
                    totalBooks: books.length,
                    categoriesCount: categories.length,
                    lastUpdated,
                  }}
                  onReorganize={handleReorganizeLibrary}
                  isReorganizing={isReorganizing}
                  userProfile={userProfile}
                  availableCategories={categories.map((c) => c.name)}
                  onSaveProfile={handleSaveProfile}
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
            books={books}
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
        <div className="w-8 h-8 border-[3px] border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
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
      <ConfirmProvider>
        <ErrorBoundary>
          <AppContent user={user} onLogout={handleLogout} />
        </ErrorBoundary>
      </ConfirmProvider>
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
