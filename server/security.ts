import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SessionInfo, UserRole } from '../shared/types.ts';
import { redisStore } from './redisStore.ts';

const JWT_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : JWT_FALLBACK_SECRET;
}

export interface JwtClaims {
  jti: string;
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  allowedTenants: string[];
  title: string;
  iat: number;
  exp: number;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
  userName: string;
  email: string;
  role: UserRole;
  allowedTenants: string[];
  jti: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: JwtClaims;
      tenantCtx?: TenantContext;
    }
  }
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64').toString('utf8');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function issueSessionJwt(
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    tenantId: string;
    allowedTenants: string[];
    title: string;
  },
  ttlSeconds = 3600 * 8
): { token: string; session: SessionInfo } {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + ttlSeconds;
  const jti = crypto.randomUUID();

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadObj: JwtClaims = {
    jti,
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    allowedTenants: user.allowedTenants,
    title: user.title,
    iat: nowSec,
    exp: expSec,
  };
  const payload = base64UrlEncode(JSON.stringify(payloadObj));
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', getJwtSecret()).update(`${header}.${payload}`).digest()
  );

  const session: SessionInfo = {
    jti,
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    allowedTenants: user.allowedTenants,
    title: user.title,
    issuedAt: new Date(nowSec * 1000).toISOString(),
    expiresAt: new Date(expSec * 1000).toISOString(),
  };

  redisStore.set(`session:jwt:${jti}`, session, ttlSeconds, {
    namespace: 'session',
    tenantId: user.tenantId,
    preview: `${user.email} (${user.role})`,
  });

  return { token: `${header}.${payload}.${signature}`, session };
}

export function verifyJwtToken(token: string): JwtClaims | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [header, payload, signature] = segments;

  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', getJwtSecret()).update(`${header}.${payload}`).digest()
  );

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as JwtClaims;
    if (!parsed.jti || !parsed.sub || !parsed.role || !parsed.tenantId) {
      return null;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp <= nowSec) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required',
      code: 'MISSING_BEARER_TOKEN',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const claims = verifyJwtToken(token);
  if (!claims) {
    res.status(401).json({
      error: 'Invalid or expired JWT signature',
      code: 'INVALID_JWT',
    });
    return;
  }

  const redisSession = redisStore.get<SessionInfo>(`session:jwt:${claims.jti}`, false);
  if (!redisSession) {
    res.status(401).json({
      error: 'Session has been revoked or expired in Redis session store',
      code: 'SESSION_REVOKED',
    });
    return;
  }

  req.auth = claims;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
      return;
    }
    if (!allowedRoles.includes(req.auth.role)) {
      res.status(403).json({
        error: `Access denied for role ${req.auth.role}. Required: ${allowedRoles.join(' or ')}`,
        code: 'RBAC_FORBIDDEN',
      });
      return;
    }
    next();
  };
}
