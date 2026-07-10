import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle, Warning, XCircle, Info, X } from '@phosphor-icons/react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType, duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

const icons = {
  success: CheckCircle,
  error: XCircle,
  warning: Warning,
  info: Info,
};

const styles = {
  success: 'bg-success-50 text-success-800 border-success-200',
  error: 'bg-danger-50 text-danger-800 border-danger-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  info: 'bg-accent-50 text-accent-800 border-accent-200',
};

const iconColors = {
  success: 'text-success-500',
  error: 'text-danger-500',
  warning: 'text-amber-500',
  info: 'text-accent-500',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType, duration = 3000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  const showSuccess = useCallback((message: string, duration?: number) => {
    showToast(message, 'success', duration);
  }, [showToast]);

  const showError = useCallback((message: string, duration?: number) => {
    showToast(message, 'error', duration);
  }, [showToast]);

  const showWarning = useCallback((message: string, duration?: number) => {
    showToast(message, 'warning', duration);
  }, [showToast]);

  const showInfo = useCallback((message: string, duration?: number) => {
    showToast(message, 'info', duration);
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
      {children}
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => {
            const Icon = icons[toast.type];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.9 }}
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg min-w-[300px] max-w-[400px] ${styles[toast.type]}`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${iconColors[toast.type]}`} weight="fill" />
                <p className="text-sm font-medium flex-1">{toast.message}</p>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="p-1 rounded-lg hover:bg-black/5 transition-colors"
                >
                  <X className="w-4 h-4 opacity-50 hover:opacity-100" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};
