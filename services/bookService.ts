/**
 * 书库 API 服务 — 替代 localStorage 的数据持久化
 *
 * 所有操作通过后端 API 完成，数据存储在 SQLite 数据库中
 */

import { Book, CategoryMeta, UserProfile } from '../types';
import { API_BASE, authHeader } from './authService';

// ============================================================================
// 书库 CRUD
// ============================================================================

/** 获取当前用户的全部书库 */
export async function fetchBooks(): Promise<Book[]> {
  const res = await fetch(`${API_BASE}/books`, {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error('获取书库失败');
  const data = await res.json();
  return data.data;
}

/** 批量保存书库（全量同步，替代 localStorage.setItem） */
export async function saveBooks(books: Book[]): Promise<Book[]> {
  const res = await fetch(`${API_BASE}/books/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ books }),
  });
  if (!res.ok) throw new Error('保存书库失败');
  const data = await res.json();
  return data.data;
}

/** 更新单本书 */
export async function updateBook(book: Book): Promise<Book> {
  const res = await fetch(`${API_BASE}/books/${book.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(book),
  });
  if (!res.ok) throw new Error('更新书籍失败');
  const data = await res.json();
  return data.data;
}

/** 删除单本书 */
export async function deleteBook(bookId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/books/${bookId}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  if (!res.ok) throw new Error('删除书籍失败');
}

// ============================================================================
// 用户画像
// ============================================================================

export async function fetchProfile(): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/profile`, {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error('获取画像失败');
  const data = await res.json();
  return data.data;
}

export async function saveProfile(profile: UserProfile): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error('保存画像失败');
  const data = await res.json();
  return data.data;
}

// ============================================================================
// 分类元数据
// ============================================================================

export async function fetchCategoryMeta(): Promise<Record<string, CategoryMeta>> {
  const res = await fetch(`${API_BASE}/profile/category-meta`, {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error('获取分类元数据失败');
  const data = await res.json();
  return data.data;
}

export async function saveCategoryMeta(categoryMeta: Record<string, CategoryMeta>): Promise<void> {
  const res = await fetch(`${API_BASE}/profile/category-meta`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ categoryMeta }),
  });
  if (!res.ok) throw new Error('保存分类元数据失败');
}
