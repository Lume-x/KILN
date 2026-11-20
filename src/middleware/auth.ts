import type { NextFunction, Request, Response } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import {
  getUserBySessionToken,
  upsertFirebaseUser,
  type SafeUserContext,
} from '../db/repositories.ts';
import type { UserRole } from '../db/schema.ts';

export const SESSION_COOKIE_NAME = 'kiln_session';

export interface AuthenticatedRequest extends Request {
  currentUser?: SafeUserContext;
  authProvider?: 'session' | 'firebase';
}

async function resolveRequestUser(
  req: AuthenticatedRequest
): Promise<{ user: SafeUserContext; provider: 'session' | 'firebase' } | null> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      const decodedToken = await adminAuth.verifyIdToken(token);
      if (!decodedToken.email) {
        return null;
      }
      const user = await upsertFirebaseUser({
        uid: decodedToken.uid,
        email: decodedToken.email,
        fullName: decodedToken.name,
      });
      if (!user.isActive) {
        return null;
      }
      return { user, provider: 'firebase' };
    }
  }

  const rawCookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (rawCookieToken) {
    const user = await getUserBySessionToken(rawCookieToken);
    if (user && user.isActive) {
      return { user, provider: 'session' };
    }
  }

  return null;
}

export async function optionalAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resolved = await resolveRequestUser(req);
    if (resolved) {
      req.currentUser = resolved.user;
      req.authProvider = resolved.provider;
    }
  } catch (error) {
    console.error('Optional auth resolution warning:', error);
  }
  next();
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resolved = await resolveRequestUser(req);
    if (!resolved) {
      res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
      return;
    }
    req.currentUser = resolved.user;
    req.authProvider = resolved.provider;
    next();
  } catch (error) {
    console.error('Auth verification failed:', error);
    res.status(401).json({ error: 'Your session could not be verified. Please sign in again.' });
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.currentUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(req.currentUser.role)) {
      res.status(403).json({
        error: 'Access denied. Your account role does not have permission for this area.',
        requiredRoles: allowedRoles,
        currentRole: req.currentUser.role,
      });
      return;
    }

    next();
  };
}
