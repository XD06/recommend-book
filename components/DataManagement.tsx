import React, { useRef, useState, useEffect } from 'react';
import { Download, Upload, Database, FileJson, AlertTriangle, CheckCircle2, ShieldCheck, Terminal, Bug, RefreshCw, X, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { Button } from './Button';
import { getDebugLogs, clearDebugLogs } from '../services/geminiService';
import { DebugLogItem } from '../types';

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
  const [logs, setLogs] = useState<DebugLogItem[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  useEffect(() => {
    refreshLogs();
  }, []);

  const refreshLogs = () => {
    setLogs(getDebugLogs());
  };

  const handleClearLogs = () => {
    clearDebugLogs();
    refreshLogs();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      onImport(e.target.files[0]);
      e.target.value = ''; // Reset input to allow selecting same file again
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("已复制到剪贴板");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
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

      {/* ================= AI Debug Console ================= */}
      <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal size={20} className="text-green-500" />
            <h3 className="font-mono font-bold text-slate-200">AI Debug Console</h3>
            <span className="text-xs px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full border border-slate-700">
              {logs.length} events
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={refreshLogs} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors" title="Refresh">
              <RefreshCw size={16} />
            </button>
            <button onClick={handleClearLogs} className="p-1.5 hover:bg-red-900/30 rounded text-slate-400 hover:text-red-400 transition-colors" title="Clear">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[500px] overflow-y-auto p-0 font-mono text-sm custom-scrollbar bg-slate-900">
          {logs.length === 0 ? (
            <div className="p-12 text-center text-slate-600">
              <Bug size={32} className="mx-auto mb-3 opacity-20" />
              <p>No AI interactions recorded yet.</p>
              <p className="text-xs mt-1">Perform some AI actions to see logs here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {logs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                const isError = !!log.error;
                
                return (
                  <div key={log.id} className={`group ${isError ? 'bg-red-900/10' : ''}`}>
                    {/* Header Row */}
                    <div 
                      onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-800/50 transition-colors"
                    >
                      <div className="text-slate-500 shrink-0">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                      <div className="text-slate-500 text-xs shrink-0 w-20">{log.timestamp}</div>
                      <div className={`font-bold shrink-0 w-40 truncate ${isError ? 'text-red-400' : 'text-blue-400'}`}>
                        {log.action}
                      </div>
                      <div className="text-slate-400 text-xs truncate flex-1 opacity-60">
                         {log.request.user ? log.request.user.slice(0, 60) + '...' : 'No prompt content'}
                      </div>
                      {isError && (
                         <span className="text-xs px-2 py-0.5 bg-red-900/50 text-red-200 rounded border border-red-800">ERROR</span>
                      )}
                    </div>

                    {/* Expanded Detail */}
                    {isExpanded && (
                      <div className="p-4 bg-slate-950 border-t border-slate-800 text-xs space-y-4">
                        
                        {/* Error Section */}
                        {log.error && (
                          <div className="bg-red-950/30 border border-red-900/50 p-3 rounded text-red-300">
                            <strong className="block mb-1 text-red-400">Error Message:</strong>
                            {log.error}
                          </div>
                        )}

                        {/* Request */}
                        <div className="space-y-2">
                           <div className="flex justify-between text-slate-500 uppercase tracking-wider font-bold">
                             <span>Request Payload</span>
                             <button onClick={() => copyToClipboard(JSON.stringify(log.request, null, 2))} className="hover:text-white"><Copy size={12}/></button>
                           </div>
                           <div className="grid grid-cols-1 gap-2">
                             {log.request.system && (
                               <div className="bg-slate-900 p-3 rounded border border-slate-800">
                                  <span className="text-green-500 block mb-1"># System Prompt</span>
                                  <div className="text-slate-300 whitespace-pre-wrap">{log.request.system}</div>
                               </div>
                             )}
                             {log.request.user && (
                               <div className="bg-slate-900 p-3 rounded border border-slate-800">
                                  <span className="text-blue-500 block mb-1"># User Prompt</span>
                                  <div className="text-slate-300 whitespace-pre-wrap">{log.request.user}</div>
                               </div>
                             )}
                           </div>
                        </div>

                        {/* Response */}
                        <div className="space-y-2">
                           <div className="flex justify-between text-slate-500 uppercase tracking-wider font-bold">
                             <span>AI Response</span>
                             <button onClick={() => copyToClipboard(log.rawResponse || '')} className="hover:text-white"><Copy size={12}/></button>
                           </div>
                           
                           {/* Raw */}
                           {log.rawResponse && (
                             <div className="bg-slate-900 p-3 rounded border border-slate-800">
                                <span className="text-purple-500 block mb-1"># Raw Output</span>
                                <div className="text-slate-400 whitespace-pre-wrap font-mono break-all">{log.rawResponse}</div>
                             </div>
                           )}
                           
                           {/* Parsed JSON */}
                           {log.response && (
                             <div className="bg-slate-900 p-3 rounded border border-slate-800">
                                <span className="text-yellow-500 block mb-1"># Parsed JSON Object</span>
                                <pre className="text-slate-300 overflow-x-auto custom-scrollbar">
                                  {JSON.stringify(log.response, null, 2)}
                                </pre>
                             </div>
                           )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};