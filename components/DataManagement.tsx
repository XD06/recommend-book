import React, { useRef } from 'react';
import { Download, Upload, Database, FileJson, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button } from './Button';

interface DataManagementProps {
  onExport: () => void;
  onImport: (file: File) => void;
  stats: {
    totalBooks: number;
    categoriesCount: number;
    lastUpdated: string;
  };
}

export const DataManagement: React.FC<DataManagementProps> = ({ onExport, onImport, stats }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      onImport(e.target.files[0]);
      e.target.value = ''; // Reset input to allow selecting same file again
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Overview Card */}
      <div className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-2xl p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
        <div className="relative z-10 flex items-start gap-6">
          <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/10">
            <Database size={32} className="text-indigo-300" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">数据保险箱</h2>
            <p className="text-indigo-200 text-sm max-w-lg leading-relaxed">
              您的所有阅读记录、AI 分析报告以及学习路径都存储在本地浏览器中。
              为了防止意外丢失或在不同设备间迁移，建议定期进行数据备份。
            </p>
            <div className="flex gap-6 mt-6">
               <div>
                 <div className="text-2xl font-bold">{stats.totalBooks}</div>
                 <div className="text-xs text-indigo-300 uppercase tracking-wider">藏书数量</div>
               </div>
               <div>
                 <div className="text-2xl font-bold">{stats.categoriesCount}</div>
                 <div className="text-xs text-indigo-300 uppercase tracking-wider">分类维度</div>
               </div>
               <div>
                 <div className="text-xl font-bold font-mono">{stats.lastUpdated}</div>
                 <div className="text-xs text-indigo-300 uppercase tracking-wider">最近操作</div>
               </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Export Section */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg transition-shadow duration-300 flex flex-col">
          <div className="flex items-center gap-3 mb-4">
             <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
               <Download size={24} />
             </div>
             <div>
               <h3 className="font-bold text-slate-900">导出备份</h3>
               <p className="text-xs text-slate-500">保存为 JSON 文件</p>
             </div>
          </div>
          
          <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-100 flex-1">
             <ul className="space-y-3">
               <li className="flex items-center text-sm text-slate-600">
                 <CheckCircle2 size={16} className="text-emerald-500 mr-2 shrink-0" /> 包含所有书籍及其详细信息
               </li>
               <li className="flex items-center text-sm text-slate-600">
                 <CheckCircle2 size={16} className="text-emerald-500 mr-2 shrink-0" /> 包含阅读进度和笔记
               </li>
               <li className="flex items-center text-sm text-slate-600">
                 <CheckCircle2 size={16} className="text-emerald-500 mr-2 shrink-0" /> 包含 AI 生成的分类路径和元数据
               </li>
             </ul>
          </div>

          <Button onClick={onExport} className="w-full justify-between group">
            <span>下载数据备份</span>
            <FileJson size={18} className="opacity-70 group-hover:opacity-100 transition-opacity" />
          </Button>
        </div>

        {/* Import Section */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-lg transition-shadow duration-300 flex flex-col">
           <div className="flex items-center gap-3 mb-4">
             <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
               <Upload size={24} />
             </div>
             <div>
               <h3 className="font-bold text-slate-900">恢复数据</h3>
               <p className="text-xs text-slate-500">从 JSON 备份还原</p>
             </div>
          </div>

          <div className="bg-amber-50/50 rounded-xl p-4 mb-6 border border-amber-100 flex-1">
             <div className="flex gap-2 items-start text-amber-800 text-sm">
               <AlertTriangle size={18} className="shrink-0 mt-0.5" />
               <p className="leading-relaxed text-xs">
                 <strong>注意：</strong> 导入操作将完全覆盖当前的本地数据。建议在执行恢复操作前，先导出当前的数据作为安全备份。
               </p>
             </div>
             <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
               <ShieldCheck size={14} /> 支持数据完整性校验
             </div>
          </div>

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".json" 
            className="hidden" 
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full justify-between hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200">
            <span>选择备份文件...</span>
            <Upload size={18} />
          </Button>
        </div>

      </div>
    </div>
  );
};