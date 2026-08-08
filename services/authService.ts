/**
 * 认证服务 — 前端 Token 管理 + API 调用
 *
 * Token 存储在 localStorage，每次 API 请求自动带上 Authorization header
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';
const TOKEN_KEY = 'deepread_token';
const USER_KEY = 'deepread_user';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
}

// ============================================================================
// Token 管理
// ============================================================================

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAuthUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

/**
 * 获取 Authorization header（带 Bearer 前缀）
 * 用于 fetch 请求的 headers
 */
export function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ============================================================================
// API 调用
// ============================================================================

export async function register(username: string, email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '注册失败');
  setAuth(data.data.token, data.data.user);
  return data.data;
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '登录失败');
  setAuth(data.data.token, data.data.user);
  return data.data;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: authHeader(),
  });
  if (!res.ok) {
    clearAuth();
    return null;
  }
  const data = await res.json();
  return data.data;
}

export function logout(): void {
  clearAuth();
}

// 导出 API_BASE 供其他服务使用
export { API_BASE };
