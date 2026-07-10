import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Download,
  Upload,
  ArrowClockwise,
  Trash,
  FileJs,
  Warning,
  Info,
} from '@phosphor-icons/react';
import { Card, CardHeader, CardContent, CardFooter } from './Card';
import { Button } from './Button';

interface DataManagementProps {
  onExport: () => void;
  onImport: (file: File) => void;
  stats: {
    totalBooks: number;
    categoriesCount: number;
    lastUpdated: string;
  };
  onReorganize?: () => void;
  isReorganizing?: boolean;
}

export const DataManagement: React.FC<DataManagementProps> = ({
  onExport,
  onImport,
  stats,
  onReorganize,
  isReorganizing = false,
}) => {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onImport(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onImport(e.target.files[0]);
    }
  };

  return (
    <div className="space-y-6 pt-20 pb-8 max-w-3xl">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      >
        <h1 className="text-2xl font-bold text-zinc-900">数据管理</h1>
        <p className="text-zinc-500 mt-1">备份、恢复和整理你的书库数据</p>
      </motion.div>

      {/* Stats Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader title="数据概览" />
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-zinc-50 rounded-xl">
              <div className="text-2xl font-bold text-zinc-900 font-mono">{stats.totalBooks}</div>
              <div className="text-xs text-zinc-500 mt-1">藏书总数</div>
            </div>
            <div className="text-center p-4 bg-zinc-50 rounded-xl">
              <div className="text-2xl font-bold text-zinc-900 font-mono">{stats.categoriesCount}</div>
              <div className="text-xs text-zinc-500 mt-1">分类数量</div>
            </div>
            <div className="text-center p-4 bg-zinc-50 rounded-xl">
              <div className="text-lg font-bold text-zinc-900">{stats.lastUpdated}</div>
              <div className="text-xs text-zinc-500 mt-1">最后更新</div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Export Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader
            title="导出数据"
            subtitle="将书库数据备份到本地文件"
            icon={<Download className="w-5 h-5 text-accent-600" />}
          />
          <CardContent>
            <div className="flex items-start gap-3 p-3 bg-accent-50 rounded-lg border border-accent-100">
              <Info className="w-4 h-4 text-accent-600 shrink-0 mt-0.5" />
              <p className="text-sm text-accent-800">
                导出的文件包含所有书籍信息、分类元数据和阅读进度。建议定期备份。
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={onExport} leftIcon={<Download className="w-4 h-4" />}>
              导出 JSON
            </Button>
          </CardFooter>
        </Card>
      </motion.div>

      {/* Import Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader
            title="导入数据"
            subtitle="从备份文件恢复书库数据"
            icon={<Upload className="w-5 h-5 text-accent-600" />}
          />
          <CardContent>
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={[
                'relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200',
                dragActive
                  ? 'border-accent-500 bg-accent-50'
                  : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50',
              ].join(' ')}
            >
              <input
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="w-12 h-12 rounded-xl bg-white border border-zinc-200 flex items-center justify-center mx-auto mb-3 shadow-sm">
                <FileJs className="w-6 h-6 text-zinc-400" />
              </div>
              <p className="text-sm font-medium text-zinc-700 mb-1">
                拖拽文件到此处，或点击选择
              </p>
              <p className="text-xs text-zinc-400">支持 .json 格式的 DeepRead 备份文件</p>
            </div>
            <div className="flex items-start gap-3 p-3 bg-warning-50 rounded-lg border border-warning-100 mt-4">
              <Warning className="w-4 h-4 text-warning-600 shrink-0 mt-0.5" />
              <p className="text-sm text-warning-800">
                导入操作将覆盖当前所有数据，请确保已备份重要信息。
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* AI Organization */}
      {onReorganize && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4, ease: [0.23, 1, 0.32, 1] }}
        >
          <Card>
            <CardHeader
              title="AI 智能整理"
              subtitle="使用 AI 重新分类和整理书库"
              icon={<ArrowClockwise className="w-5 h-5 text-accent-600" />}
            />
            <CardContent>
              <div className="flex items-start gap-3 p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                <Info className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                <p className="text-sm text-zinc-600">
                  AI 将分析所有书籍的内容和主题，自动分配到最合适的分类中。此操作会修改现有分类结构。
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button
                variant="secondary"
                onClick={onReorganize}
                isLoading={isReorganizing}
                leftIcon={<ArrowClockwise className="w-4 h-4" />}
              >
                开始整理
              </Button>
            </CardFooter>
          </Card>
        </motion.div>
      )}

      {/* Danger Zone */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5, ease: [0.23, 1, 0.32, 1] }}
      >
        <Card>
          <CardHeader
            title="危险区域"
            subtitle="不可逆操作，请谨慎使用"
            icon={<Trash className="w-5 h-5 text-danger-500" />}
          />
          <CardContent>
            <div className="flex items-start gap-3 p-3 bg-danger-50 rounded-lg border border-danger-100">
              <Warning className="w-4 h-4 text-danger-600 shrink-0 mt-0.5" />
              <p className="text-sm text-danger-800">
                清除所有数据将无法恢复。建议先导出备份。
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('确定要清除所有数据吗？此操作无法撤销。')) {
                  localStorage.clear();
                  window.location.reload();
                }
              }}
              leftIcon={<Trash className="w-4 h-4" />}
            >
              清除所有数据
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
};
