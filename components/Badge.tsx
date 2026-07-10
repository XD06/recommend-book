import React from 'react';

type Variant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
type Size = 'sm' | 'md';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  size?: Size;
  dot?: boolean;
}

const variantStyles: Record<Variant, string> = {
  default: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  primary: 'bg-accent-50 text-accent-700 border-accent-200',
  success: 'bg-success-50 text-success-700 border-success-200',
  warning: 'bg-warning-50 text-warning-700 border-warning-200',
  danger: 'bg-danger-50 text-danger-700 border-danger-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
};

const dotColors: Record<Variant, string> = {
  default: 'bg-zinc-400',
  primary: 'bg-accent-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-blue-500',
};

export const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  size = 'sm',
  dot = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 font-medium border rounded-full',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        variantStyles[variant],
        className,
      ].join(' ')}
      {...props}
    >
      {dot && (
        <span className={['w-1.5 h-1.5 rounded-full', dotColors[variant]].join(' ')} />
      )}
      {children}
    </span>
  );
};
