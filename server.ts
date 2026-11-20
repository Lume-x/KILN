import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './src/db/index.ts';
import {
  AuthenticationError,
  ConflictError,
  authenticateEmailUser,
  createPartnershipInquiry,
  createUserSession,
  deleteUserSession,
  getPublicCollectionPoints,
  getPublicImpactSummary,
  getPublicMaterialCategories,
  registerEmailUser,
  updateOwnUserProfile,
} from './src/db/repositories.ts';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assignAgentToRequestAdmin,
  cancelUserCollectionRequest,
  createCollectionPointAdmin,
  createCollectionRequest,
  getCollectionRequestForViewer,
  listActiveAgentsAdmin,
  listAgentAssignments,
  listAllCollectionPointsAdmin,
  listAllCollectionRequestsAdmin,
  listDropOffCollectionPoints,
  listUserCollectionRequests,
  respondToAssignmentAgent,
  reviewWeightVerificationAdmin,
  submitWeightRecordAgent,
  updateCollectionPointAdmin,
  updateCollectionProgressAgent,
  updateRequestReviewStatusAdmin,
} from './src/db/collection-repository.ts';
import {
  SESSION_COOKIE_NAME,
  optionalAuth,
  requireAuth,
  requireRole,
  type AuthenticatedRequest,
} from './src/middleware/auth.ts';
import { isValidEmail, validatePasswordStrength } from './src/lib/security.ts';
import {
  cancelUserRedemption,
  createRedemptionRequest,
  deactivateRewardRateAdmin,
  getRedemptionSettings,
  getUserWalletWithLedger,
  listAllRedemptionsAdmin,
  listRecentLedgerTransactionsAdmin,
  listRewardRatesAdmin,
  listUserRedemptions,
  postAdminWalletAdjustment,
  transitionRedemptionStatusAdmin,
  updateRedemptionSettingsAdmin,
  upsertMaterialRewardRateAdmin,
} from './src/db/rewards-repository.ts';
import {
  getUserNotificationPreferences,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateUserNotificationPreferences,
} from './src/db/notifications-repository.ts';
import {
  adjustInventoryEntryAdmin,
  consolidateBatchesAdmin,
  createMaterialBatchAdmin,
  createMaterialSaleAdmin,
  createMaterialTransferAdmin,
  createStorageLocationAdmin,
  getInventorySummaryAdmin,
  listInventoryEntriesAdmin,
  listInventoryMovementsAdmin,
  listMaterialBatchesAdmin,
  listMaterialSalesAdmin,
  listMaterialTransfersAdmin,
  listStorageLocationsAdmin,
  updateMaterialSaleStatusAdmin,
  updateMaterialTransferStatusAdmin,
  updateStorageLocationAdmin,
} from './src/db/inventory-repository.ts';
import {
  bindUserNostrPubkey,
  connectUserNwc,
  createNostrChallenge,
  disconnectUserNwc,
  executeLightningPayoutAdmin,
  getIntegrationSettingsSafe,
  getUserNwcStatus,
  listLightningPaymentsAdmin,
  listNostrPublicationsAdmin,
  publishProofOfRecyclingAdmin,
  unlinkUserNostrPubkey,
  updateIntegrationSettingsAdmin,
} from './src/services/integrations-service.ts';
import {
  classifyWasteForUser,
  listUserAiClassifications,
} from './src/services/ai-sorter-service.ts';
import {
  createOrUpdateLearningModuleAdmin,
  listAllLearningModulesAdmin,
  listLearningModulesForUser,
  submitLearningQuizAttempt,
} from './src/db/learning-repository.ts';
import {
  createMaterialCategoryAdmin,
  generateAdminCsvExport,
  getAdminDashboardOverview,
  getOperationalReportsAdmin,
  getUserDetailAdmin,
  listAllMaterialsAdmin,
  listAuditLogsAdmin,
  listUsersAdmin,
  updateMaterialCategoryAdmin,
  updateUserAccountAdmin,
  type CsvReportType,
} from './src/db/admin-reports-repository.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_PARTNER_TYPES = new Set([
  'RECYCLING_BUSINESS',
  'COMMUNITY_ORG',
  'LOCAL_BUSINESS',
  'COLLECTION_PARTNER',
  'GENERAL',
]);

const ALLOWED_COMMUNITIES = new Set([
  'FUTO Campus',
  'Ihiagwa',
  'Eziobodo',
  'Obinze',
  'Umuchima',
  'Nekede',
  'Owerri Municipal',
  'Other (Imo State)',
]);

function setSessionCookie(res: Response, rawToken: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    ...(isProd ? { partitioned: true } : {}),
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res: Response) {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    ...(isProd ? { partitioned: true } : {}),
    path: '/',
  });
}

function createSlidingWindowRateLimiter(maxAttempts: number, windowMs: number) {
  const buckets = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const cutoff = now - windowMs;
    const recent = (buckets.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= maxAttempts) {
      buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    buckets.set(key, recent);
    if (buckets.size > 5000) {
      for (const [k, v] of buckets.entries()) {
        if (!v.some((ts) => ts > cutoff)) buckets.delete(k);
      }
    }
    return true;
  };
}

const allowLoginAttempt = createSlidingWindowRateLimiter(30, 15 * 60 * 1000);
const allowRegisterAttempt = createSlidingWindowRateLimiter(25, 15 * 60 * 1000);

function handleDomainError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof ForbiddenError) {
    res.status(403).json({ error: error.message });
    return;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  console.error('[KILN API Error]', fallbackMessage, error instanceof Error ? error.message : error);
  res.status(500).json({ error: fallbackMessage });
}

async function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers (preserve iframe embedding compatibility by omitting X-Frame-Options)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });

  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());

  // Cross-site request forgery protection for cookie-authenticated API mutations
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      next();
      return;
    }
    const originHeader = req.headers.origin;
    const hasBearerAuth =
      typeof req.headers.authorization === 'string' &&
      req.headers.authorization.startsWith('Bearer ');
    const hasSessionCookie = Boolean(req.cookies?.[SESSION_COOKIE_NAME]);

    if (originHeader && hasSessionCookie && !hasBearerAuth) {
      try {
        const originHost = new URL(originHeader).host.toLowerCase();
        const forwardedHost =
          typeof req.headers['x-forwarded-host'] === 'string'
            ? req.headers['x-forwarded-host'].split(',')[0].trim().toLowerCase()
            : '';
        const requestHost = (forwardedHost || req.headers.host || '').toLowerCase();
        const configuredHost = process.env.APP_URL
          ? (() => {
              try {
                return new URL(process.env.APP_URL).host.toLowerCase();
              } catch {
                return '';
              }
            })()
          : '';
        if (originHost !== requestHost && (!configuredHost || originHost !== configuredHost)) {
          res.status(403).json({ error: 'Cross-origin state-changing request rejected.' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Invalid request origin header.' });
        return;
      }
    }
    next();
  });

  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      await pool.query('SELECT 1');
      res.json({
        ok: true,
        service: 'KILN',
        database: 'connected',
        stage: 'Stages 1–9 MVP',
      });
    } catch {
      res.status(503).json({
        ok: false,
        service: 'KILN',
        database: 'unavailable',
      });
    }
  });

  // ============================================================
  // PUBLIC WEBSITE APIS (STAGE 2)
  // ============================================================
  app.get('/api/public/materials', async (_req: Request, res: Response) => {
    try {
      const materials = await getPublicMaterialCategories();
      res.json({ materials });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to load material categories.');
    }
  });

  app.get('/api/public/collection-points', async (_req: Request, res: Response) => {
    try {
      const collectionPoints = await getPublicCollectionPoints();
      res.json({ collectionPoints });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to load pilot collection points.');
    }
  });

  app.get('/api/public/impact', async (_req: Request, res: Response) => {
    try {
      const impact = await getPublicImpactSummary();
      res.json({ impact });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to load community impact data.');
    }
  });

  app.post('/api/public/partnerships', async (req: Request, res: Response) => {
    try {
      const { organizationName, contactName, email, phone, partnerType, message } = req.body ?? {};

      if (typeof organizationName !== 'string' || organizationName.trim().length < 2) {
        res.status(400).json({ error: 'Please provide your organisation or group name.' });
        return;
      }
      if (typeof contactName !== 'string' || contactName.trim().length < 2) {
        res.status(400).json({ error: 'Please provide a contact person name.' });
        return;
      }
      if (typeof email !== 'string' || !isValidEmail(email)) {
        res.status(400).json({ error: 'Please provide a valid email address.' });
        return;
      }
      if (typeof partnerType !== 'string' || !ALLOWED_PARTNER_TYPES.has(partnerType)) {
        res.status(400).json({ error: 'Please select a valid partnership category.' });
        return;
      }
      if (typeof message !== 'string' || message.trim().length < 15) {
        res.status(400).json({
          error:
            'Please share a brief message (at least 15 characters) about how you would like to work with KILN.',
        });
        return;
      }

      const created = await createPartnershipInquiry({
        organizationName,
        contactName,
        email,
        phone: typeof phone === 'string' ? phone : undefined,
        partnerType,
        message,
      });

      res.status(201).json({
        inquiry: created,
        message: 'Thank you. Your partnership inquiry has been recorded for the KILN pilot team.',
      });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to submit inquiry right now.');
    }
  });

  // ============================================================
  // AUTHENTICATION & ACCOUNT APIS (STAGE 1 & 2)
  // ============================================================
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      const clientKey = req.ip || 'unknown';
      if (!allowRegisterAttempt(clientKey)) {
        res.status(429).json({
          error: 'Too many registration attempts from this connection. Please wait a few minutes.',
        });
        return;
      }

      const { fullName, email, phoneNumber, password, communityArea, termsAccepted } =
        req.body ?? {};

      if (typeof fullName !== 'string' || fullName.trim().length < 2) {
        res.status(400).json({ error: 'Please enter your full name.' });
        return;
      }
      if (typeof email !== 'string' || !isValidEmail(email)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }
      if (typeof password !== 'string') {
        res.status(400).json({ error: 'Please enter a password.' });
        return;
      }
      const passwordError = validatePasswordStrength(password);
      if (passwordError) {
        res.status(400).json({ error: passwordError });
        return;
      }
      if (termsAccepted !== true) {
        res.status(400).json({ error: 'You must accept the KILN pilot terms to register.' });
        return;
      }

      const resolvedArea =
        typeof communityArea === 'string' && ALLOWED_COMMUNITIES.has(communityArea)
          ? communityArea
          : 'FUTO Campus';

      const user = await registerEmailUser({
        fullName,
        email,
        phoneNumber: typeof phoneNumber === 'string' ? phoneNumber : undefined,
        password,
        communityArea: resolvedArea,
      });

      const rawToken = await createUserSession(user.id);
      setSessionCookie(res, rawToken);

      res.status(201).json({ user });
    } catch (error: unknown) {
      if (error instanceof ConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      handleDomainError(res, error, 'Unable to complete registration.');
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body ?? {};
      const rateKey = `${req.ip || 'unknown'}:${typeof email === 'string' ? email.trim().toLowerCase() : ''}`;
      if (!allowLoginAttempt(rateKey)) {
        res.status(429).json({
          error: 'Too many sign-in attempts. Please wait 15 minutes before trying again.',
        });
        return;
      }

      if (typeof email !== 'string' || !isValidEmail(email) || typeof password !== 'string') {
        res.status(400).json({ error: 'Please provide your email address and password.' });
        return;
      }

      const user = await authenticateEmailUser(email, password);
      const rawToken = await createUserSession(user.id);
      setSessionCookie(res, rawToken);

      res.json({ user });
    } catch (error: unknown) {
      if (error instanceof AuthenticationError) {
        res.status(401).json({ error: error.message });
        return;
      }
      handleDomainError(res, error, 'Unable to sign in right now.');
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      const rawCookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
      if (rawCookieToken) {
        await deleteUserSession(rawCookieToken);
      }
      clearSessionCookie(res);
      res.json({ ok: true });
    } catch (error: unknown) {
      clearSessionCookie(res);
      const message = error instanceof Error ? error.message : 'Logged out locally.';
      res.status(200).json({ ok: true, note: message });
    }
  });

  app.get('/api/auth/me', optionalAuth, (req: AuthenticatedRequest, res: Response) => {
    if (!req.currentUser) {
      res.json({ authenticated: false, user: null });
      return;
    }
    res.json({
      authenticated: true,
      provider: req.authProvider ?? 'session',
      user: req.currentUser,
    });
  });

  app.patch(
    '/api/account/profile',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = req.currentUser!.id;
        const { fullName, phoneNumber, communityArea, address, lightningAddress } = req.body ?? {};

        if (typeof fullName !== 'string' || fullName.trim().length < 2) {
          res.status(400).json({ error: 'Full name must be at least 2 characters.' });
          return;
        }

        const resolvedArea =
          typeof communityArea === 'string' && ALLOWED_COMMUNITIES.has(communityArea)
            ? communityArea
            : req.currentUser!.communityArea;

        const updatedUser = await updateOwnUserProfile(userId, {
          fullName,
          phoneNumber: typeof phoneNumber === 'string' ? phoneNumber : undefined,
          communityArea: resolvedArea,
          address: typeof address === 'string' ? address : undefined,
          lightningAddress: typeof lightningAddress === 'string' ? lightningAddress : undefined,
        });

        res.json({ user: updatedUser });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to save profile updates.');
      }
    }
  );

  app.get('/api/rbac/role-check', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const role = req.currentUser!.role;
    res.json({
      role,
      permissions: {
        canSubmitCollections: true,
        canAccessAgentWorkspace: role === 'AGENT' || role === 'ADMIN',
        canAccessAdminWorkspace: role === 'ADMIN',
      },
    });
  });

  app.get(
    '/api/rbac/agent-access',
    requireAuth,
    requireRole('AGENT', 'ADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      res.json({
        authorized: true,
        scope: 'AGENT_OPERATIONS',
        role: req.currentUser!.role,
      });
    }
  );

  app.get(
    '/api/rbac/admin-access',
    requireAuth,
    requireRole('ADMIN'),
    (req: AuthenticatedRequest, res: Response) => {
      res.json({
        authorized: true,
        scope: 'ADMIN_OPERATIONS',
        role: req.currentUser!.role,
      });
    }
  );

  // ============================================================
  // STAGE 3: PARTICIPANT COLLECTION REQUEST APIS
  // ============================================================
  app.get(
    '/api/collections/drop-off-points',
    requireAuth,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const collectionPoints = await listDropOffCollectionPoints();
        res.json({ collectionPoints });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load available drop-off points.');
      }
    }
  );

  app.get('/api/collections', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const requests = await listUserCollectionRequests(req.currentUser!.id, status);
      res.json({ requests });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to load your collection requests.');
    }
  });

  app.post('/api/collections', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const created = await createCollectionRequest(req.currentUser!, req.body ?? {});
      res.status(201).json({ request: created });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to create collection request.');
    }
  });

  app.get(
    '/api/collections/:id',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const requestId = Number(req.params.id);
        if (!Number.isInteger(requestId) || requestId <= 0) {
          res.status(400).json({ error: 'Invalid collection request ID.' });
          return;
        }
        const requestRecord = await getCollectionRequestForViewer(requestId, req.currentUser!);
        res.json({ request: requestRecord });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load collection request details.');
      }
    }
  );

  app.post(
    '/api/collections/:id/cancel',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const requestId = Number(req.params.id);
        if (!Number.isInteger(requestId) || requestId <= 0) {
          res.status(400).json({ error: 'Invalid collection request ID.' });
          return;
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const updated = await cancelUserCollectionRequest(requestId, req.currentUser!.id, reason);
        res.json({ request: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to cancel collection request.');
      }
    }
  );

  // ============================================================
  // STAGE 3: COLLECTION AGENT APIS (ROLE: AGENT)
  // ============================================================
  app.get(
    '/api/agent/assignments',
    requireAuth,
    requireRole('AGENT', 'ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const assignments = await listAgentAssignments(req.currentUser!.id, status);
        res.json({ assignments });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load assigned collections.');
      }
    }
  );

  app.post(
    '/api/agent/assignments/:assignmentId/respond',
    requireAuth,
    requireRole('AGENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const assignmentId = Number(req.params.assignmentId);
        if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
          res.status(400).json({ error: 'Invalid assignment ID.' });
          return;
        }
        const decision = req.body?.decision;
        if (decision !== 'ACCEPT' && decision !== 'REJECT') {
          res.status(400).json({ error: 'Decision must be ACCEPT or REJECT.' });
          return;
        }
        const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
        const updated = await respondToAssignmentAgent(
          assignmentId,
          req.currentUser!.id,
          decision,
          note
        );
        res.json({ request: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to submit assignment response.');
      }
    }
  );

  app.post(
    '/api/agent/assignments/:assignmentId/progress',
    requireAuth,
    requireRole('AGENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const assignmentId = Number(req.params.assignmentId);
        if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
          res.status(400).json({ error: 'Invalid assignment ID.' });
          return;
        }
        const nextStatus = req.body?.nextStatus;
        if (nextStatus !== 'IN_PROGRESS' && nextStatus !== 'COLLECTED') {
          res.status(400).json({ error: 'Status update must be IN_PROGRESS or COLLECTED.' });
          return;
        }
        const updated = await updateCollectionProgressAgent(
          assignmentId,
          req.currentUser!.id,
          nextStatus
        );
        res.json({ request: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update collection progress.');
      }
    }
  );

  app.post(
    '/api/agent/assignments/:assignmentId/weight',
    requireAuth,
    requireRole('AGENT'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const assignmentId = Number(req.params.assignmentId);
        if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
          res.status(400).json({ error: 'Invalid assignment ID.' });
          return;
        }
        const updated = await submitWeightRecordAgent(
          assignmentId,
          req.currentUser!.id,
          req.body ?? {}
        );
        res.status(201).json({ request: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to submit physical weight record.');
      }
    }
  );

  // ============================================================
  // STAGE 3: ADMINISTRATOR COLLECTION & VERIFICATION APIS (ROLE: ADMIN)
  // ============================================================
  app.get(
    '/api/admin/collections',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const method = typeof req.query.method === 'string' ? req.query.method : undefined;
        const materialCategoryId = req.query.materialCategoryId
          ? Number(req.query.materialCategoryId)
          : undefined;
        const requests = await listAllCollectionRequestsAdmin({
          status,
          method,
          materialCategoryId:
            materialCategoryId && Number.isInteger(materialCategoryId)
              ? materialCategoryId
              : undefined,
        });
        res.json({ requests });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load collection requests.');
      }
    }
  );

  app.get(
    '/api/admin/agents',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const agents = await listActiveAgentsAdmin();
        res.json({ agents });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load active agents.');
      }
    }
  );

  app.post(
    '/api/admin/collections/:id/review',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const requestId = Number(req.params.id);
        if (!Number.isInteger(requestId) || requestId <= 0) {
          res.status(400).json({ error: 'Invalid collection request ID.' });
          return;
        }
        const decision = req.body?.decision;
        if (decision !== 'APPROVED' && decision !== 'REJECTED') {
          res.status(400).json({ error: 'Decision must be APPROVED or REJECTED.' });
          return;
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const updated = await updateRequestReviewStatusAdmin(
          requestId,
          req.currentUser!.id,
          decision,
          reason
        );
        res.json({ request: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to review collection request.');
      }
    }
  );

  app.post(
    '/api/admin/collections/:id/assign',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const requestId = Number(req.params.id);
        const agentUserId = Number(req.body?.agentUserId);
        if (!Number.isInteger(requestId) || requestId <= 0) {
          res.status(400).json({ error: 'Invalid collection request ID.' });
          return;
        }
        if (!Number.isInteger(agentUserId) || agentUserId <= 0) {
          res.status(400).json({ error: 'Please select an active collection agent.' });
          return;
        }
        const updated = await assignAgentToRequestAdmin(
          requestId,
          agentUserId,
          req.currentUser!.id
        );
        res.json({ request: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to assign collection agent.');
      }
    }
  );

  app.post(
    '/api/admin/collections/:id/verify',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const requestId = Number(req.params.id);
        if (!Number.isInteger(requestId) || requestId <= 0) {
          res.status(400).json({ error: 'Invalid collection request ID.' });
          return;
        }
        const updated = await reviewWeightVerificationAdmin(
          requestId,
          req.currentUser!.id,
          req.body ?? {}
        );
        res.json({ request: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to verify collection weight.');
      }
    }
  );

  app.get(
    '/api/admin/collection-points',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const collectionPoints = await listAllCollectionPointsAdmin();
        res.json({ collectionPoints });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load collection points.');
      }
    }
  );

  app.post(
    '/api/admin/collection-points',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const created = await createCollectionPointAdmin(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ collectionPoint: created });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to create collection point.');
      }
    }
  );

  app.patch(
    '/api/admin/collection-points/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const pointId = Number(req.params.id);
        if (!Number.isInteger(pointId) || pointId <= 0) {
          res.status(400).json({ error: 'Invalid collection point ID.' });
          return;
        }
        const updated = await updateCollectionPointAdmin(
          pointId,
          req.currentUser!.id,
          req.body ?? {}
        );
        res.json({ collectionPoint: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update collection point.');
      }
    }
  );

  // ============================================================
  // STAGE 4: PARTICIPANT WALLET, REDEMPTIONS & NOTIFICATIONS
  // ============================================================
  app.get('/api/wallet', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const txType = typeof req.query.type === 'string' ? req.query.type : undefined;
      const [walletData, settings] = await Promise.all([
        getUserWalletWithLedger(req.currentUser!.id, txType),
        getRedemptionSettings(),
      ]);
      res.json({ ...walletData, settings });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to load reward wallet.');
    }
  });

  app.get('/api/redemptions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const redemptions = await listUserRedemptions(req.currentUser!.id);
      res.json({ redemptions });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to load redemption requests.');
    }
  });

  app.post('/api/redemptions', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const created = await createRedemptionRequest(req.currentUser!, req.body ?? {});
      res.status(201).json({ redemption: created });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to submit redemption request.');
    }
  });

  app.post(
    '/api/redemptions/:id/cancel',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const redemptionId = Number(req.params.id);
        if (!Number.isInteger(redemptionId) || redemptionId <= 0) {
          res.status(400).json({ error: 'Invalid redemption ID.' });
          return;
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const updated = await cancelUserRedemption(redemptionId, req.currentUser!.id, reason);
        res.json({ redemption: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to cancel redemption request.');
      }
    }
  );

  app.get('/api/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const unreadOnly = req.query.unreadOnly === 'true';
      const result = await listUserNotifications(req.currentUser!.id, unreadOnly);
      res.json(result);
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to load notifications.');
    }
  });

  app.post(
    '/api/notifications/:id/read',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const notificationId = Number(req.params.id);
        if (!Number.isInteger(notificationId) || notificationId <= 0) {
          res.status(400).json({ error: 'Invalid notification ID.' });
          return;
        }
        await markNotificationRead(req.currentUser!.id, notificationId);
        res.json({ ok: true });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to mark notification as read.');
      }
    }
  );

  app.post(
    '/api/notifications/read-all',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        await markAllNotificationsRead(req.currentUser!.id);
        res.json({ ok: true });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to mark notifications as read.');
      }
    }
  );

  app.get(
    '/api/notifications/preferences',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const preferences = await getUserNotificationPreferences(req.currentUser!.id);
        res.json({ preferences });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load notification preferences.');
      }
    }
  );

  app.patch(
    '/api/notifications/preferences',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const preferences = await updateUserNotificationPreferences(
          req.currentUser!.id,
          req.body ?? {}
        );
        res.json({ preferences });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update notification preferences.');
      }
    }
  );

  // ============================================================
  // STAGE 6: USER OPTIONAL NWC WALLET & NOSTR IDENTITY
  // ============================================================
  app.get('/api/integrations/nwc', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const [connection, settings] = await Promise.all([
        getUserNwcStatus(req.currentUser!.id),
        getIntegrationSettingsSafe(),
      ]);
      res.json({
        connection,
        lightningEnabled: settings.lightningEnabled,
        lightningMode: settings.lightningMode,
      });
    } catch (error: unknown) {
      handleDomainError(res, error, 'Unable to load NWC wallet status.');
    }
  });

  app.post(
    '/api/integrations/nwc',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const connection = await connectUserNwc(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ connection });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to connect NWC wallet.');
      }
    }
  );

  app.delete(
    '/api/integrations/nwc',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        await disconnectUserNwc(req.currentUser!.id);
        res.json({ ok: true });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to disconnect NWC wallet.');
      }
    }
  );

  app.post(
    '/api/integrations/nostr/challenge',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const challenge = await createNostrChallenge(req.currentUser!.id);
        res.status(201).json({ challenge });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to create Nostr challenge.');
      }
    }
  );

  app.post(
    '/api/integrations/nostr/link',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const result = await bindUserNostrPubkey(req.currentUser!.id, req.body ?? {});
        res.json(result);
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to link Nostr public key.');
      }
    }
  );

  app.delete(
    '/api/integrations/nostr/link',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const result = await unlinkUserNostrPubkey(req.currentUser!.id);
        res.json(result);
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to unlink Nostr public key.');
      }
    }
  );

  // ============================================================
  // STAGE 7: AI WASTE SORTER & LEARN AND EARN
  // ============================================================
  app.post(
    '/api/ai-sorter/classify',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const result = await classifyWasteForUser(req.currentUser!.id, req.body ?? {});
        res.json({ classification: result });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to classify waste item.');
      }
    }
  );

  app.get(
    '/api/ai-sorter/history',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const history = await listUserAiClassifications(req.currentUser!.id);
        res.json({ history });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load AI classification history.');
      }
    }
  );

  app.get(
    '/api/learning/modules',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const modules = await listLearningModulesForUser(req.currentUser!.id);
        res.json({ modules });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load learning modules.');
      }
    }
  );

  app.post(
    '/api/learning/modules/:id/submit',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const moduleId = Number(req.params.id);
        if (!Number.isInteger(moduleId) || moduleId <= 0) {
          res.status(400).json({ error: 'Invalid learning module ID.' });
          return;
        }
        const result = await submitLearningQuizAttempt(
          req.currentUser!.id,
          moduleId,
          req.body?.answers
        );
        res.json({ result });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to grade learning quiz.');
      }
    }
  );

  // ============================================================
  // STAGE 4 ADMIN: REWARD RATES, REDEMPTIONS & WALLET ADJUSTMENTS
  // ============================================================
  app.get(
    '/api/admin/reward-rates',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const data = await listRewardRatesAdmin();
        res.json(data);
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load reward rates.');
      }
    }
  );

  app.post(
    '/api/admin/reward-rates',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const created = await upsertMaterialRewardRateAdmin(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ rate: created });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to save material reward rate.');
      }
    }
  );

  app.post(
    '/api/admin/reward-rates/:id/deactivate',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const rateId = Number(req.params.id);
        if (!Number.isInteger(rateId) || rateId <= 0) {
          res.status(400).json({ error: 'Invalid reward rate ID.' });
          return;
        }
        const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const updated = await deactivateRewardRateAdmin(rateId, req.currentUser!.id, reason);
        res.json({ rate: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to deactivate reward rate.');
      }
    }
  );

  app.get(
    '/api/admin/redemption-settings',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const settings = await getRedemptionSettings();
        res.json({ settings });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load redemption settings.');
      }
    }
  );

  app.patch(
    '/api/admin/redemption-settings',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const settings = await updateRedemptionSettingsAdmin(req.currentUser!.id, req.body ?? {});
        res.json({ settings });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update redemption settings.');
      }
    }
  );

  app.get(
    '/api/admin/redemptions',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const method = typeof req.query.method === 'string' ? req.query.method : undefined;
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const redemptions = await listAllRedemptionsAdmin({ status, method, search });
        res.json({ redemptions });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load redemption queue.');
      }
    }
  );

  app.post(
    '/api/admin/redemptions/:id/transition',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const redemptionId = Number(req.params.id);
        if (!Number.isInteger(redemptionId) || redemptionId <= 0) {
          res.status(400).json({ error: 'Invalid redemption ID.' });
          return;
        }
        const updated = await transitionRedemptionStatusAdmin(
          redemptionId,
          req.currentUser!.id,
          req.body ?? {}
        );
        res.json({ redemption: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to transition redemption status.');
      }
    }
  );

  app.get(
    '/api/admin/ledger',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = req.query.limit ? Number(req.query.limit) : 100;
        const transactions = await listRecentLedgerTransactionsAdmin(
          Number.isFinite(limit) ? Math.min(250, Math.max(10, limit)) : 100
        );
        res.json({ transactions });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load ledger transactions.');
      }
    }
  );

  app.post(
    '/api/admin/wallet-adjustments',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const result = await postAdminWalletAdjustment(req.currentUser!.id, req.body ?? {});
        res.status(201).json(result);
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to post wallet adjustment.');
      }
    }
  );

  // ============================================================
  // STAGE 5 ADMIN: INVENTORY, LOCATIONS, BATCHES, TRANSFERS & SALES
  // ============================================================
  app.get(
    '/api/admin/inventory/summary',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const summary = await getInventorySummaryAdmin();
        res.json({ summary });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load inventory summary.');
      }
    }
  );

  app.get(
    '/api/admin/storage-locations',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const locations = await listStorageLocationsAdmin();
        res.json({ locations });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load storage locations.');
      }
    }
  );

  app.post(
    '/api/admin/storage-locations',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const created = await createStorageLocationAdmin(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ location: created });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to create storage location.');
      }
    }
  );

  app.patch(
    '/api/admin/storage-locations/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const locationId = Number(req.params.id);
        if (!Number.isInteger(locationId) || locationId <= 0) {
          res.status(400).json({ error: 'Invalid storage location ID.' });
          return;
        }
        const updated = await updateStorageLocationAdmin(
          locationId,
          req.currentUser!.id,
          req.body ?? {}
        );
        res.json({ location: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update storage location.');
      }
    }
  );

  app.get(
    '/api/admin/inventory/entries',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const materialCategoryId = req.query.materialCategoryId
          ? Number(req.query.materialCategoryId)
          : undefined;
        const storageLocationId = req.query.storageLocationId
          ? Number(req.query.storageLocationId)
          : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const entries = await listInventoryEntriesAdmin({
          materialCategoryId:
            materialCategoryId && Number.isInteger(materialCategoryId)
              ? materialCategoryId
              : undefined,
          storageLocationId:
            storageLocationId && Number.isInteger(storageLocationId)
              ? storageLocationId
              : undefined,
          status,
        });
        res.json({ entries });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load inventory entries.');
      }
    }
  );

  app.post(
    '/api/admin/inventory/entries/:id/adjust',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const entryId = Number(req.params.id);
        if (!Number.isInteger(entryId) || entryId <= 0) {
          res.status(400).json({ error: 'Invalid inventory entry ID.' });
          return;
        }
        const updated = await adjustInventoryEntryAdmin(
          entryId,
          req.currentUser!.id,
          req.body ?? {}
        );
        res.json({ entry: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to adjust inventory entry.');
      }
    }
  );

  app.get(
    '/api/admin/inventory/batches',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const materialCategoryId = req.query.materialCategoryId
          ? Number(req.query.materialCategoryId)
          : undefined;
        const storageLocationId = req.query.storageLocationId
          ? Number(req.query.storageLocationId)
          : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const batches = await listMaterialBatchesAdmin({
          materialCategoryId:
            materialCategoryId && Number.isInteger(materialCategoryId)
              ? materialCategoryId
              : undefined,
          storageLocationId:
            storageLocationId && Number.isInteger(storageLocationId)
              ? storageLocationId
              : undefined,
          status,
        });
        res.json({ batches });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load material batches.');
      }
    }
  );

  app.post(
    '/api/admin/inventory/batches',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const batch = await createMaterialBatchAdmin(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ batch });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to create material batch.');
      }
    }
  );

  app.post(
    '/api/admin/inventory/batches/consolidate',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const batch = await consolidateBatchesAdmin(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ batch });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to consolidate material batches.');
      }
    }
  );

  app.get(
    '/api/admin/inventory/transfers',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const transfers = await listMaterialTransfersAdmin();
        res.json({ transfers });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load material transfers.');
      }
    }
  );

  app.post(
    '/api/admin/inventory/transfers',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const transfer = await createMaterialTransferAdmin(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ transfer });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to create material transfer.');
      }
    }
  );

  app.post(
    '/api/admin/inventory/transfers/:id/status',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const transferId = Number(req.params.id);
        if (!Number.isInteger(transferId) || transferId <= 0) {
          res.status(400).json({ error: 'Invalid transfer ID.' });
          return;
        }
        const transfer = await updateMaterialTransferStatusAdmin(
          transferId,
          req.currentUser!.id,
          req.body?.status ?? req.body?.nextStatus
        );
        res.json({ transfer });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update transfer status.');
      }
    }
  );

  app.get(
    '/api/admin/inventory/sales',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const sales = await listMaterialSalesAdmin();
        res.json({ sales });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load material sales.');
      }
    }
  );

  app.post(
    '/api/admin/inventory/sales',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const sale = await createMaterialSaleAdmin(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ sale });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to record material sale.');
      }
    }
  );

  app.patch(
    '/api/admin/inventory/sales/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const saleId = Number(req.params.id);
        if (!Number.isInteger(saleId) || saleId <= 0) {
          res.status(400).json({ error: 'Invalid sale ID.' });
          return;
        }
        const sale = await updateMaterialSaleStatusAdmin(
          saleId,
          req.currentUser!.id,
          req.body ?? {}
        );
        res.json({ sale });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update sale status.');
      }
    }
  );

  app.get(
    '/api/admin/inventory/movements',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = req.query.limit ? Number(req.query.limit) : 120;
        const movements = await listInventoryMovementsAdmin(
          Number.isFinite(limit) ? Math.min(250, Math.max(10, limit)) : 120
        );
        res.json({ movements });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load inventory movements.');
      }
    }
  );

  // ============================================================
  // STAGE 6 ADMIN: INTEGRATIONS (LIGHTNING / NWC / NOSTR / AI)
  // ============================================================
  app.get(
    '/api/admin/integrations/settings',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const settings = await getIntegrationSettingsSafe();
        res.json({ settings });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load integration settings.');
      }
    }
  );

  app.patch(
    '/api/admin/integrations/settings',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const settings = await updateIntegrationSettingsAdmin(req.currentUser!.id, req.body ?? {});
        res.json({ settings });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update integration settings.');
      }
    }
  );

  app.post(
    '/api/admin/integrations/lightning/payout/:redemptionId',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const redemptionId = Number(req.params.redemptionId);
        if (!Number.isInteger(redemptionId) || redemptionId <= 0) {
          res.status(400).json({ error: 'Invalid redemption ID.' });
          return;
        }
        const result = await executeLightningPayoutAdmin(redemptionId, req.currentUser!.id, {
          simulateFailure: req.body?.simulateFailure === true,
        });
        res.json({ payout: result });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to execute Lightning payout.');
      }
    }
  );

  app.get(
    '/api/admin/integrations/lightning/payments',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const payments = await listLightningPaymentsAdmin();
        res.json({ payments });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load Lightning payments.');
      }
    }
  );

  app.get(
    '/api/admin/integrations/nostr/publications',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const data = await listNostrPublicationsAdmin();
        res.json(data);
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load Nostr publications.');
      }
    }
  );

  app.post(
    '/api/admin/integrations/nostr/publish/:verificationId',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const verificationId = Number(req.params.verificationId);
        if (!Number.isInteger(verificationId) || verificationId <= 0) {
          res.status(400).json({ error: 'Invalid verification ID.' });
          return;
        }
        const publication = await publishProofOfRecyclingAdmin(
          verificationId,
          req.currentUser!.id,
          { simulateFailure: req.body?.simulateFailure === true }
        );
        res.json({ publication });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to publish Proof-of-Recycling.');
      }
    }
  );

  // ============================================================
  // STAGE 7 & 8 ADMIN: OVERVIEW, USERS, MATERIALS, LEARNING, REPORTS, CSV & AUDIT
  // ============================================================
  app.get(
    '/api/admin/overview',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const overview = await getAdminDashboardOverview();
        res.json({ overview });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load admin dashboard overview.');
      }
    }
  );

  app.get(
    '/api/admin/users',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const role = typeof req.query.role === 'string' ? req.query.role : undefined;
        const usersList = await listUsersAdmin({ search, role });
        res.json({ users: usersList });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load users.');
      }
    }
  );

  app.get(
    '/api/admin/users/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const targetId = Number(req.params.id);
        if (!Number.isInteger(targetId) || targetId <= 0) {
          res.status(400).json({ error: 'Invalid user ID.' });
          return;
        }
        const detail = await getUserDetailAdmin(targetId);
        res.json({ user: detail });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load user profile details.');
      }
    }
  );

  app.patch(
    '/api/admin/users/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const targetId = Number(req.params.id);
        if (!Number.isInteger(targetId) || targetId <= 0) {
          res.status(400).json({ error: 'Invalid user ID.' });
          return;
        }
        const updated = await updateUserAccountAdmin(targetId, req.currentUser!.id, req.body ?? {});
        res.json({ user: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update user account.');
      }
    }
  );

  app.get(
    '/api/admin/materials',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const materials = await listAllMaterialsAdmin();
        res.json({ materials });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load material categories.');
      }
    }
  );

  app.post(
    '/api/admin/materials',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const created = await createMaterialCategoryAdmin(req.currentUser!.id, req.body ?? {});
        res.status(201).json({ material: created });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to create material category.');
      }
    }
  );

  app.patch(
    '/api/admin/materials/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
          res.status(400).json({ error: 'Invalid material category ID.' });
          return;
        }
        const updated = await updateMaterialCategoryAdmin(
          categoryId,
          req.currentUser!.id,
          req.body ?? {}
        );
        res.json({ material: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update material category.');
      }
    }
  );

  app.get(
    '/api/admin/learning/modules',
    requireAuth,
    requireRole('ADMIN'),
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const data = await listAllLearningModulesAdmin();
        res.json(data);
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load learning modules.');
      }
    }
  );

  app.post(
    '/api/admin/learning/modules',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const created = await createOrUpdateLearningModuleAdmin(
          req.currentUser!.id,
          null,
          req.body ?? {}
        );
        res.status(201).json({ module: created });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to create learning module.');
      }
    }
  );

  app.patch(
    '/api/admin/learning/modules/:id',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const moduleId = Number(req.params.id);
        if (!Number.isInteger(moduleId) || moduleId <= 0) {
          res.status(400).json({ error: 'Invalid learning module ID.' });
          return;
        }
        const updated = await createOrUpdateLearningModuleAdmin(
          req.currentUser!.id,
          moduleId,
          req.body ?? {}
        );
        res.json({ module: updated });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to update learning module.');
      }
    }
  );

  app.get(
    '/api/admin/reports',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
        const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const method = typeof req.query.method === 'string' ? req.query.method : undefined;
        const materialCategoryId = req.query.materialCategoryId
          ? Number(req.query.materialCategoryId)
          : undefined;
        const reports = await getOperationalReportsAdmin({
          dateFrom,
          dateTo,
          status,
          method,
          materialCategoryId:
            materialCategoryId && Number.isInteger(materialCategoryId)
              ? materialCategoryId
              : undefined,
        });
        res.json({ reports });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to generate operational reports.');
      }
    }
  );

  app.get(
    '/api/admin/reports/export',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const rawType = typeof req.query.type === 'string' ? req.query.type : '';
        const allowedTypes = new Set<CsvReportType>([
          'collections',
          'verifications',
          'rewards',
          'redemptions',
          'inventory',
          'sales',
          'audit',
        ]);
        if (!allowedTypes.has(rawType as CsvReportType)) {
          res.status(400).json({
            error:
              'Invalid export type. Use collections, verifications, rewards, redemptions, inventory, sales, or audit.',
          });
          return;
        }
        const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined;
        const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const method = typeof req.query.method === 'string' ? req.query.method : undefined;
        const materialCategoryId = req.query.materialCategoryId
          ? Number(req.query.materialCategoryId)
          : undefined;

        const { filename, csv } = await generateAdminCsvExport(
          rawType as CsvReportType,
          {
            dateFrom,
            dateTo,
            status,
            method,
            materialCategoryId:
              materialCategoryId && Number.isInteger(materialCategoryId)
                ? materialCategoryId
                : undefined,
          },
          req.currentUser!.id
        );

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to generate CSV export.');
      }
    }
  );

  app.get(
    '/api/admin/audit-logs',
    requireAuth,
    requireRole('ADMIN'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const action = typeof req.query.action === 'string' ? req.query.action : undefined;
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const limit = req.query.limit ? Number(req.query.limit) : 120;
        const logs = await listAuditLogsAdmin({
          action,
          search,
          limit: Number.isFinite(limit) ? limit : 120,
        });
        res.json({ logs });
      } catch (error: unknown) {
        handleDomainError(res, error, 'Unable to load audit logs.');
      }
    }
  );

  // Unknown API route JSON 404 handler
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Global error boundary (never expose stack traces or raw internals to clients)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.parse.failed'
    ) {
      res.status(400).json({ error: 'Malformed JSON request body.' });
      return;
    }
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'Request payload exceeds maximum allowed size.' });
      return;
    }
    console.error('[KILN Unhandled Error]', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`KILN server listening on http://0.0.0.0:${port}`);
  });
}

createApp().catch((err) => {
  console.error('Failed to start KILN server:', err);
  process.exit(1);
});
