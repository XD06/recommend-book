import React from 'react';
import { Library, BarChart3, Settings, Plus, Sparkles } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onImportClick: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, onImportClick }) => {
  const navItems = [
    { id: 'library', label: '书库', icon: Library },
    { id: 'advisor', label: '顾问', icon: Sparkles }, // New Item
    { id: 'stats', label: '统计', icon: BarChart3 },
    { id: 'settings', label: '管理', icon: Settings },
  ];

  return (
    <>
      {/* ================= DESKTOP SIDEBAR (Hidden on Mobile) ================= */}
      <div className="hidden md:flex w-64 bg-slate-900 text-slate-300 flex-col h-screen fixed left-0 top-0 z-40 transition-all duration-300 border-r border-slate-800">
        {/* Logo Area */}
        <div className="h-20 flex items-center px-8 border-b border-slate-800">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-900/50">
            <Library size={22} />
          </div>
          <span className="ml-3 font-serif font-bold text-xl text-slate-100 tracking-wide">DeepRead</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-8 px-4 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center px-4 py-3 rounded-xl transition-all duration-200 group relative ${
                activeTab === item.id 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30' 
                  : 'hover:bg-slate-800 hover:text-white'
              }`}
            >
              <item.icon size={20} strokeWidth={activeTab === item.id ? 2.5 : 2} />
              <span className={`ml-3 font-medium ${activeTab === item.id ? 'font-bold' : ''}`}>
                {item.label}
              </span>
              {activeTab === item.id && (
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white/20 rounded-l-full" />
              )}
            </button>
          ))}
        </nav>

        {/* Action Area */}
        <div className="p-4 border-t border-slate-800">
          <button 
            onClick={onImportClick}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white rounded-xl p-3 flex items-center transition-all border border-slate-700 hover:border-slate-600 group"
          >
            <div className="bg-emerald-500/20 text-emerald-400 p-1.5 rounded-lg group-hover:bg-emerald-500 group-hover:text-white transition-colors">
              <Plus size={18} />
            </div>
            <span className="ml-3 font-medium">导入书籍</span>
          </button>
        </div>
      </div>

      {/* ================= MOBILE BOTTOM BAR (Hidden on Desktop) ================= */}
      <div className="md:hidden fixed bottom-0 left-0 w-full bg-slate-900 border-t border-slate-800 z-50 flex items-center justify-around pb-safe pt-2 px-2 h-20 shadow-[0_-4px_10px_rgba(0,0,0,0.2)]">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`flex flex-col items-center justify-center p-2 rounded-xl w-16 transition-all ${
              activeTab === item.id 
                ? 'text-indigo-400' 
                : 'text-slate-500'
            }`}
          >
            <div className={`p-1.5 rounded-full mb-1 transition-all ${activeTab === item.id ? 'bg-indigo-900/50' : ''}`}>
               <item.icon size={20} strokeWidth={activeTab === item.id ? 2.5 : 2} />
            </div>
            <span className="text-[10px] font-medium">
              {item.label}
            </span>
          </button>
        ))}
        
        {/* Floating Action Button for Import (Mobile) */}
        <div className="absolute -top-6 left-1/2 -translate-x-1/2">
           <button 
             onClick={onImportClick}
             className="w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-indigo-900/50 border-4 border-slate-50"
           >
             <Plus size={28} />
           </button>
        </div>
      </div>
    </>
  );
};