/**
 * JWT 认证中间件
 *
 * 用法：
 *   router.get('/protected', requireAuth, (req, res) => {
 *     const userId = req.user!.id;
 *   });
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'deepread-dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

// 生产环境强制检查 JWT_SECRET
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.startsWith('deepread-'))) {
  console.error('\n⚠️  [安全警告] 生产环境未配置安全的 JWT_SECRET！\n' +
    '请在 .env 中设置一个强随机字符串，可使用以下命令生成：\n' +
    '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
    '当前使用的是默认值，攻击者可以伪造任意用户的 Token！\n');
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
}

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * 签发 JWT
 */
export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

/**
 * 验证 JWT 并将用户信息挂到 req.user
 *
 * 如果没有 token 或 token 无效，返回 401
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未提供认证令牌' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = { id: payload.id, username: payload.username, email: payload.email };
    next();
  } catch {
    res.status(401).json({ success: false, error: '认证令牌已过期或无效' });
  }
}

/**
 * 可选认证 — 有 token 就解析，没有也放行（req.user 可能为 undefined）
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
      req.user = { id: payload.id, username: payload.username, email: payload.email };
    } catch {
      // token 无效就当没登录
    }
  }
  next();
}
