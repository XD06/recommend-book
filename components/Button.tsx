import React from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<Variant, string> = {
  primary: `
    bg-accent-600 text-white
    hover:bg-accent-700
    active:bg-accent-800
    shadow-sm hover:shadow-md
  `,
  secondary: `
    bg-white text-zinc-900
    border border-zinc-200
    hover:bg-zinc-50 hover:border-zinc-300
    active:bg-zinc-100
    shadow-sm
  `,
  ghost: `
    bg-transparent text-zinc-600
    hover:bg-zinc-100 hover:text-zinc-900
    active:bg-zinc-200
  `,
  danger: `
    bg-danger-500 text-white
    hover:bg-danger-600
    active:bg-danger-700
    shadow-sm
  `,
  outline: `
    bg-transparent text-zinc-700
    border border-zinc-300
    hover:bg-zinc-50 hover:border-zinc-400
    active:bg-zinc-100
  `,
};

const sizeStyles: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-6 py-2.5 text-base gap-2.5',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      className = '',
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles = `
      inline-flex items-center justify-center
      font-medium
      rounded-lg
      transition-all duration-fast ease-out-expo
      active:scale-[0.97]
      disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
      focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2
    `;

    return (
      <button
        ref={ref}
        className={[
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          fullWidth ? 'w-full' : '',
          className,
        ].join(' ')}
        disabled={isLoading || disabled}
        {...props}
      >
        {isLoading && (
          <Spinner
            size={size === 'sm' ? 'xs' : size === 'lg' ? 'sm' : 'sm'}
            className={variant === 'primary' || variant === 'danger' ? 'text-white/70' : 'text-zinc-400'}
          />
        )}
        {!isLoading && leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';
