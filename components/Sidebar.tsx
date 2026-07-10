import React from 'react';
import { BookOpen, ChatCircle, ChartBar, GearFine, Plus } from '@phosphor-icons/react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onImportClick: () => void;
}

const navItems = [
  { id: 'library', label: '书库', icon: BookOpen },
  { id: 'advisor', label: '顾问', icon: ChatCircle },
  { id: 'stats', label: '统计', icon: ChartBar },
  { id: 'settings', label: '管理', icon: GearFine },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onImportClick }) => {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col fixed left-0 top-0 h-screen border-r border-zinc-200 bg-white z-40">
        {/* Brand */}
        <div className="h-16 flex items-center px-5 border-b border-zinc-100">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center">
            <BookOpen size={18} weight="bold" className="text-white" />
          </div>
          <span className="ml-2.5 font-semibold text-[15px] text-zinc-900 tracking-tight">DeepRead</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={[
                  'w-full flex items-center px-3 py-2 rounded-lg text-sm font-medium',
                  'transition-colors duration-150 ease-out',
                  'active:scale-[0.98]',
                  active
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
                ].join(' ')}
                style={{ transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
              >
                <Icon size={18} weight={active ? 'fill' : 'regular'} />
                <span className="ml-2.5">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Import button */}
        <div className="p-3 border-t border-zinc-100">
          <button
            onClick={onImportClick}
            className={[
              'w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium',
              'bg-accent-50 text-accent-700 hover:bg-accent-100',
              'transition-colors duration-150 ease-out active:scale-[0.98]',
            ].join(' ')}
            style={{ transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
          >
            <Plus size={18} weight="bold" />
            导入书籍
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t border-zinc-200 z-50 flex items-center justify-around pb-safe pt-2 px-2 h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={[
                'flex flex-col items-center justify-center px-3 py-1 rounded-lg',
                'transition-colors duration-150',
                active ? 'text-zinc-900' : 'text-zinc-400',
              ].join(' ')}
            >
              <Icon size={22} weight={active ? 'fill' : 'regular'} />
              <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile FAB */}
      <button
        onClick={onImportClick}
        className="md:hidden fixed right-4 bottom-20 w-12 h-12 rounded-full bg-zinc-900 text-white flex items-center justify-center shadow-lg z-50 active:scale-95 transition-transform duration-150"
        style={{ transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
      >
        <Plus size={22} weight="bold" />
      </button>
    </>
  );
};
