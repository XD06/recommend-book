import React, { Component, ErrorInfo, ReactNode } from 'react';
import { motion } from 'motion/react';
import { WarningCircle, ArrowClockwise, House } from '@phosphor-icons/react';

// ============================================================================
// ErrorBoundary — 捕获 React 组件树中的运行时错误
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] 捕获到错误:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.hash = '';
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="max-w-md"
          >
            {/* 错误图标 — 带抖动动画 */}
            <motion.div
              initial={{ x: 0 }}
              animate={{ x: [0, -8, 8, -6, 6, 0] }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-5"
            >
              <WarningCircle size={32} weight="duotone" />
            </motion.div>

            <h2 className="text-xl font-bold text-zinc-900 mb-2">出了点小问题</h2>
            <p className="text-sm text-zinc-500 mb-6 leading-relaxed">
              页面遇到了意外错误。你可以尝试刷新页面，或返回首页重新开始。
            </p>

            {/* 错误详情（可折叠） */}
            {this.state.error && (
              <details className="mb-6 text-left">
                <summary className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-600 transition-colors">
                  查看错误详情
                </summary>
                <pre className="mt-2 p-3 bg-zinc-50 rounded-lg text-xs text-zinc-600 overflow-auto max-h-32">
                  {this.state.error.message}
                  {this.state.error.stack && `\n\n${this.state.error.stack}`}
                </pre>
              </details>
            )}

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 active:scale-95 transition-all flex items-center gap-2"
              >
                <ArrowClockwise size={16} />
                重试
              </button>
              <button
                onClick={this.handleGoHome}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-zinc-200 text-zinc-600 hover:bg-zinc-50 active:scale-95 transition-all flex items-center gap-2"
              >
                <House size={16} />
                返回首页
              </button>
            </div>
          </motion.div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// LoadingSpinner — 多种变体的加载动画
// ============================================================================

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  variant?: 'spinner' | 'dots' | 'pulse';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  label,
  variant = 'spinner',
}) => {
  const sizeMap = {
    sm: { spinner: 'w-4 h-4', dot: 'w-1.5 h-1.5', text: 'text-xs' },
    md: { spinner: 'w-6 h-6', dot: 'w-2 h-2', text: 'text-sm' },
    lg: { spinner: 'w-10 h-10', dot: 'w-2.5 h-2.5', text: 'text-base' },
  };
  const s = sizeMap[size];

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      {variant === 'spinner' && (
        <div
          className={`${s.spinner} border-2 border-zinc-200 border-t-accent-500 rounded-full animate-spin`}
          style={{ animationDuration: '0.8s' }}
        />
      )}

      {variant === 'dots' && (
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className={`${s.dot} bg-accent-500 rounded-full`}
              animate={{ y: [0, -8, 0], opacity: [0.4, 1, 0.4] }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: i * 0.15,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      )}

      {variant === 'pulse' && (
        <div className="relative flex items-center justify-center">
          <motion.div
            className={`${s.spinner} rounded-full bg-accent-200`}
            animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className={`${s.spinner} absolute rounded-full bg-accent-500 opacity-30`} />
        </div>
      )}

      {label && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className={`${s.text} text-zinc-500`}
        >
          {label}
        </motion.p>
      )}
    </div>
  );
};

// ============================================================================
// EmptyState — 统一的空状态组件（带动画）
// ============================================================================

interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
  iconColor?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  iconColor = 'bg-zinc-100 text-zinc-400',
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
    >
      {Icon && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
          className={`w-14 h-14 rounded-2xl ${iconColor} flex items-center justify-center mb-4`}
        >
          <Icon size={28} weight="duotone" />
        </motion.div>
      )}
      <h3 className="text-lg font-semibold text-zinc-900 mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-zinc-500 max-w-sm leading-relaxed mb-4">{description}</p>
      )}
      {action}
    </motion.div>
  );
};

// ============================================================================
// ErrorRetry — 错误重试组件（用于 SSE 流失败等场景）
// ============================================================================

interface ErrorRetryProps {
  message: string;
  onRetry: () => void;
  details?: string;
}

export const ErrorRetry: React.FC<ErrorRetryProps> = ({ message, onRetry, details }) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col items-center gap-3 py-6 px-4 text-center"
    >
      <motion.div
        initial={{ rotate: 0 }}
        animate={{ rotate: [0, -10, 10, 0] }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="w-10 h-10 rounded-xl bg-rose-50 text-rose-400 flex items-center justify-center"
      >
        <WarningCircle size={20} weight="duotone" />
      </motion.div>
      <p className="text-sm text-rose-600 max-w-sm">{message}</p>
      {details && (
        <p className="text-xs text-zinc-400 max-w-sm">{details}</p>
      )}
      <button
        onClick={onRetry}
        className="px-4 py-2 rounded-xl text-sm font-medium border border-zinc-200 text-zinc-600 hover:bg-zinc-50 active:scale-95 transition-all flex items-center gap-2"
      >
        <ArrowClockwise size={14} />
        重试
      </button>
    </motion.div>
  );
};
