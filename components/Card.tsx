import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'ghost';
  hover?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const variantStyles = {
  default: 'bg-white border border-zinc-200/80 shadow-sm',
  elevated: 'bg-white border border-zinc-200/60 shadow-card',
  ghost: 'bg-zinc-50/50 border border-transparent',
};

const paddingStyles = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'default',
      hover = false,
      padding = 'md',
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={[
          'rounded-xl',
          'transition-all duration-normal ease-out-expo',
          variantStyles[variant],
          paddingStyles[padding],
          hover
            ? 'cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 hover:border-zinc-300/80'
            : '',
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

// Card Header
interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  action,
  icon,
  className = '',
  children,
  ...props
}) => {
  return (
    <div className={['flex items-start justify-between gap-4 mb-4', className].join(' ')} {...props}>
      <div className="flex-1 min-w-0 flex items-start gap-3">
        {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
        <div className="flex-1 min-w-0">
          {title && <h3 className="text-base font-semibold text-zinc-900 truncate">{title}</h3>}
          {subtitle && <p className="text-sm text-zinc-500 mt-0.5">{subtitle}</p>}
          {children}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

// Card Content
export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
};

// Card Footer
export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => {
  return (
    <div className={['flex items-center gap-3 pt-4 mt-4 border-t border-zinc-100', className].join(' ')} {...props}>
      {children}
    </div>
  );
};
