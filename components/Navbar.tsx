import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Books,
  Sparkle,
  ChartLineUp,
  Gear,
  Plus,
  MagnifyingGlass,
  Command,
  SignOut,
} from '@phosphor-icons/react';
import { Button } from './Button';

interface NavbarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onImportClick: () => void;
  user?: { username: string; email: string };
  onLogout?: () => void;
}

const navItems = [
  { id: 'library', label: '书库', icon: Books },
  { id: 'advisor', label: 'AI 顾问', icon: Sparkle },
  { id: 'stats', label: '统计', icon: ChartLineUp },
  { id: 'settings', label: '设置', icon: Gear },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onImportClick,
  user,
  onLogout,
}) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      {/* Main Navbar */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        className={[
          'fixed top-0 left-0 right-0 z-50',
          'transition-all duration-normal ease-out-expo',
          isScrolled
            ? 'py-3'
            : 'py-4',
        ].join(' ')}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <div
            className={[
              'flex items-center justify-between gap-4',
              'px-4 py-2.5 rounded-2xl',
              'transition-all duration-normal ease-out-expo',
              isScrolled
                ? 'bg-white/80 backdrop-blur-xl shadow-glass border border-white/50'
                : 'bg-transparent',
            ].join(' ')}
          >
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent-600 flex items-center justify-center shadow-sm">
                <Books weight="fill" className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-zinc-900 text-lg tracking-tight hidden sm:block">
                DeepRead
              </span>
            </div>

            {/* Nav Links - Desktop */}
            <nav className="hidden md:flex items-center gap-1 bg-zinc-100/80 rounded-xl p-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={[
                      'relative flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg',
                      'transition-all duration-fast ease-out-expo',
                      isActive
                        ? 'text-zinc-900'
                        : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/50',
                    ].join(' ')}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute inset-0 bg-white rounded-lg shadow-sm"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                      />
                    )}
                    <span className="relative flex items-center gap-2">
                      <Icon weight={isActive ? 'fill' : 'regular'} className="w-4 h-4" />
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Search Button */}
              <button
                onClick={() => setShowSearch(true)}
                className={[
                  'hidden sm:flex items-center gap-2 px-3 py-2 text-sm text-zinc-500',
                  'bg-zinc-100 hover:bg-zinc-200 rounded-lg',
                  'transition-colors duration-fast',
                ].join(' ')}
              >
                <MagnifyingGlass className="w-4 h-4" />
                <span className="text-zinc-400">搜索</span>
                <kbd className="hidden lg:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono bg-white rounded border border-zinc-200 text-zinc-400">
                  <Command className="w-3 h-3" />K
                </kbd>
              </button>

              {/* Add Book Button */}
              <Button
                size="sm"
                leftIcon={<Plus className="w-4 h-4" />}
                onClick={onImportClick}
                className="hidden sm:flex"
              >
                添加书籍
              </Button>

              {/* User Menu */}
              {user && (
                <div className="flex items-center gap-2">
                  <span className="hidden sm:block text-sm text-zinc-600 font-medium">{user.username}</span>
                  <button
                    onClick={onLogout}
                    title="退出登录"
                    className="p-2 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
                  >
                    <SignOut className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Mobile Menu Button */}
              <button
                className="md:hidden p-2 text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                onClick={() => {/* Toggle mobile menu */}}
              >
                <div className="w-5 h-0.5 bg-current rounded-full mb-1" />
                <div className="w-5 h-0.5 bg-current rounded-full mb-1" />
                <div className="w-5 h-0.5 bg-current rounded-full" />
              </button>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-xl border-t border-zinc-200/80 safe-area-pb">
        <div className="flex items-center justify-around py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={[
                  'flex flex-col items-center gap-1 px-4 py-2 rounded-xl',
                  'transition-colors duration-fast',
                  isActive ? 'text-accent-600' : 'text-zinc-400',
                ].join(' ')}
              >
                <Icon weight={isActive ? 'fill' : 'regular'} className="w-5 h-5" />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Search Modal */}
      <AnimatePresence>
        {showSearch && (
          <SearchModal onClose={() => setShowSearch(false)} />
        )}
      </AnimatePresence>
    </>
  );
};

// Search Modal Component
interface SearchModalProps {
  onClose: () => void;
}

const SearchModal: React.FC<SearchModalProps> = ({ onClose }) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-zinc-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 10 }}
        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-xl mx-4 bg-white rounded-2xl shadow-modal overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-4 border-b border-zinc-100">
          <MagnifyingGlass className="w-5 h-5 text-zinc-400" />
          <input
            type="text"
            placeholder="搜索书籍、作者、分类..."
            className="flex-1 text-base outline-none placeholder:text-zinc-400"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <kbd className="hidden sm:inline-flex px-2 py-1 text-xs font-mono bg-zinc-100 rounded text-zinc-500">
            ESC
          </kbd>
        </div>
        <div className="p-2">
          <div className="px-3 py-2 text-xs font-medium text-zinc-400 uppercase tracking-wide">
            最近搜索
          </div>
          <div className="text-sm text-zinc-500 px-3 py-8 text-center">
            输入关键词开始搜索
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
