import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      fullWidth = true,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || React.useId();
    const hasError = !!error;

    return (
      <div className={fullWidth ? 'w-full' : ''}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-zinc-700 mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={[
              'w-full px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400',
              'bg-white border rounded-lg',
              'transition-all duration-fast ease-out',
              'focus:outline-none focus:ring-2 focus:ring-accent-100',
              'disabled:bg-zinc-50 disabled:text-zinc-400 disabled:cursor-not-allowed',
              leftIcon ? 'pl-10' : '',
              rightIcon ? 'pr-10' : '',
              hasError
                ? 'border-danger-300 focus:border-danger-500 focus:ring-danger-100'
                : 'border-zinc-200 focus:border-accent-500',
              className,
            ].join(' ')}
            aria-invalid={hasError}
            aria-describedby={hasError ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
              {rightIcon}
            </div>
          )}
        </div>
        {helperText && !hasError && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-xs text-zinc-500">
            {helperText}
          </p>
        )}
        {hasError && (
          <p id={`${inputId}-error`} className="mt-1.5 text-xs text-danger-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// TextArea
interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
  fullWidth?: boolean;
  rows?: number;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    {
      label,
      helperText,
      error,
      fullWidth = true,
      rows = 4,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || React.useId();
    const hasError = !!error;

    return (
      <div className={fullWidth ? 'w-full' : ''}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-zinc-700 mb-1.5"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          className={[
            'w-full px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400',
            'bg-white border rounded-lg resize-y min-h-[100px]',
            'transition-all duration-fast ease-out',
            'focus:outline-none focus:ring-2 focus:ring-accent-100',
            'disabled:bg-zinc-50 disabled:text-zinc-400 disabled:cursor-not-allowed',
            hasError
              ? 'border-danger-300 focus:border-danger-500 focus:ring-danger-100'
              : 'border-zinc-200 focus:border-accent-500',
            className,
          ].join(' ')}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          {...props}
        />
        {helperText && !hasError && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-xs text-zinc-500">
            {helperText}
          </p>
        )}
        {hasError && (
          <p id={`${inputId}-error`} className="mt-1.5 text-xs text-danger-600">
            {error}
          </p>
        )}
      </div>
    );
  }
);

TextArea.displayName = 'TextArea';
