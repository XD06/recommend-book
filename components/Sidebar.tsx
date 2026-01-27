import React from 'react';
import { Library, BarChart3, Settings, Plus } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onImportClick: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onImportClick }) => {
  const navItems = [
    { id: 'library', label: '我的书库', icon: Library },
    { id: 'stats', label: '阅读统计', icon: BarChart3 },
    { id: 'settings', label: '数据管理', icon: Settings },
  ];

  return (
    <div className="w-20 md:w-64 bg-slate-900 text-slate-300 flex flex-col h-screen fixed left-0 top-0 z-40 transition-all duration-300 border-r border-slate-800">
      {/* Logo Area */}
      <div className="h-20 flex items-center justify-center md:justify-start px-0 md:px-8 border-b border-slate-800">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-900/50">
          <Library size={22} />
        </div>
        <span className="ml-3 font-serif font-bold text-xl text-slate-100 hidden md:block tracking-wide">DeepRead</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-8 px-3 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`w-full flex items-center justify-center md:justify-start px-3 py-3 rounded-xl transition-all duration-200 group relative ${
              activeTab === item.id 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30' 
                : 'hover:bg-slate-800 hover:text-white'
            }`}
          >
            <item.icon size={20} strokeWidth={activeTab === item.id ? 2.5 : 2} />
            <span className={`ml-3 font-medium hidden md:block ${activeTab === item.id ? 'font-bold' : ''}`}>
              {item.label}
            </span>
            {activeTab === item.id && (
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white/20 rounded-l-full hidden md:block" />
            )}
          </button>
        ))}
      </nav>

      {/* Action Area */}
      <div className="p-4 border-t border-slate-800">
        <button 
          onClick={onImportClick}
          className="w-full bg-slate-800 hover:bg-slate-700 text-white rounded-xl p-3 flex items-center justify-center md:justify-start transition-all border border-slate-700 hover:border-slate-600"
        >
          <div className="bg-emerald-500/20 text-emerald-400 p-1.5 rounded-lg">
            <Plus size={18} />
          </div>
          <span className="ml-3 font-medium hidden md:block">导入书籍</span>
        </button>
      </div>
    </div>
  );
};