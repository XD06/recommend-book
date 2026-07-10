import React from 'react';

interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  xs: 'w-3 h-3 border-2',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-[2.5px]',
  lg: 'w-8 h-8 border-3',
};

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '' }) => {
  return (
    <span
      className={[
        'inline-block rounded-full border-current border-t-transparent',
        'animate-spin',
        sizeMap[size],
        className,
      ].join(' ')}
      role="status"
      aria-label="加载中"
    />
  );
};
