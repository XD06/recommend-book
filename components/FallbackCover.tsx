import React, { useState } from 'react';

/**
 * FallbackCover — 书籍封面组件（含加载失败兜底）
 *
 * 统一处理封面加载逻辑：
 * - 有封面 URL 时渲染 <img>
 * - 加载失败或无 URL 时渲染色块 + 书名
 * - 替代各组件中重复的 onError + parent.innerHTML 方案
 *
 * 安全性：避免 innerHTML 注入风险（书名可能含特殊字符）
 */

function generateColor(str: string): string {
  const colors = [
    '#4f46e5', '#7c3aed', '#2563eb', '#0891b2', '#059669',
    '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

interface FallbackCoverProps {
  title: string;
  author?: string;
  coverUrl?: string;
  coverColor?: string;
  className?: string;
  /** 显示模式：'cover' 满铺图片，'fallback' 仅色块 */
  variant?: 'cover' | 'fallback';
  /** 色块模式下是否显示作者 */
  showAuthor?: boolean;
  /** 色块文字大小 */
  textSize?: 'xs' | 'sm' | 'md';
  rounded?: string;
}

export const FallbackCover: React.FC<FallbackCoverProps> = ({
  title,
  author,
  coverUrl,
  coverColor,
  className = '',
  showAuthor = false,
  textSize = 'sm',
  rounded = 'rounded-lg',
}) => {
  const [imgError, setImgError] = useState(false);
  const color = coverColor || generateColor(title);

  // 有 URL 且未出错 → 渲染图片
  if (coverUrl && !imgError) {
    return (
      <img
        src={coverUrl}
        alt={title}
        className={`object-cover ${rounded} ${className}`}
        loading="lazy"
        onError={() => setImgError(true)}
      />
    );
  }

  // 兜底：色块 + 书名
  const textClass = textSize === 'xs' ? 'text-[10px]' : textSize === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div
      className={`${rounded} flex items-center justify-center p-2 ${className}`}
      style={{ backgroundColor: color }}
    >
      <div className="text-center">
        <span className={`text-white font-medium ${textClass} line-clamp-3 drop-shadow-md`}>
          {title}
        </span>
        {showAuthor && author && (
          <span className="text-white/80 text-[10px] mt-1 line-clamp-1">
            {author}
          </span>
        )}
      </div>
    </div>
  );
};
