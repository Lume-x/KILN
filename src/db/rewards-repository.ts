import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  materialCategories,
  redemptionRequests,
  redemptionSettings,
  redemptionStatusHistory,
  rewardLedgerTransactions,
  rewardRates,
  rewardWallets,
  users,
  type LedgerDirection,
  type LedgerTransactionType,
  type RedemptionMethod,
  type RedemptionStatus,
} from './schema.ts';
import {
  ALLOWED_REDEMPTION_METHODS,
  calculateEstimatedPayoutValue,
  canTransitionRedemptionStatus,
  formatCentsToPoints,
  generateScopedReference,
  parseDecimalToScaledInt,
  parsePointsToCents,
  parseSignedDecimalToScaledInt,
  validateRedemptionDestination,
} from '../lib/rewards-rules.ts';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from './collection-repository.ts';
import { createNotificationTx, notifyActiveAdminsTx } from './notifications-repository.ts';
import type { SafeUserContext } from './repositories.ts';

type PgTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Ensures a user's reward wallet exists and locks the wallet row FOR UPDATE inside a transaction.
 */
export async function ensureAndLockWalletTx(tx: PgTransaction, userId: number) {
  await tx
    .insert(rewardWallets)
    .values({
      userId,
      availablePoints: '0.00',
      totalEarnedPoints: '0.00',
      totalRedeemedPoints: '0.00',
      pendingRedemptionPoints: '0.00',
    })
    .onConflictDoNothing({ target: rewardWallets.userId });

  const lockResult = await tx.execute(
    sql`SELECT id, user_id, available_points, total_earned_points, total_redeemed_points, pending_redemption_points
        FROM reward_wallets
        WHERE user_id = ${userId}
        FOR UPDATE`
  );

  const row = lockResult.rows[0] as
    | {
        id: number;
        user_id: number;
        available_points: string;
        total_earned_points: string;
        total_redeemed_points: string;
        pending_redemption_points: string;
      }
    | undefined;

  if (!row) {
    throw new Error('Could not acquire reward wallet lock.');
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    availableCents: parsePointsToCents(row.available_points) ?? 0n,
    totalEarnedCents: parsePointsToCents(row.total_earned_points) ?? 0n,
    totalRedeemedCents: parsePointsToCents(row.total_redeemed_points) ?? 0n,
    pendingRedemptionCents: parsePointsToCents(row.pending_redemption_points) ?? 0n,
  };
}

/**
 * Finds the active reward rate for a material category at the current timestamp.
 */
export async function getActiveRewardRateTx(tx: PgTransaction, materialCategoryId: number) {
  const [rate] = await tx
    .select()
    .from(rewardRates)
    .where(
      and(
        eq(rewardRates.materialCategoryId, materialCategoryId),
        eq(rewardRates.isActive, true),
        lte(rewardRates.effectiveFrom, new Date())
      )
    )
    .orderBy(desc(rewardRates.effectiveFrom), desc(rewardRates.id))
    .limit(1);

  return rate ?? null;
}

/**
 * Credits a reward transaction atomically inside an existing transaction using idempotency key + FOR UPDATE lock.
 * Guarantees zero duplicate credits and strictly consistent ledger-backed wallet balances.
 */
export async function creditWalletLedgerTx(
  tx: PgTransaction,
  params: {
    userId: number;
    amountCents: bigint;
    transactionType: Extract<
      LedgerTransactionType,
      'COLLECTION_REWARD' | 'LEARNING_BONUS' | 'ADMIN_ADJUSTMENT' | 'REVERSAL'
    >;
    idempotencyKey: string;
    description: string;
    verificationId?: number | null;
    redemptionRequestId?: number | null;
    appliedRatePerKg?: string | null;
    actorUserId?: number | null;
    isDemo?: boolean;
    incrementTotalEarned?: boolean;
  }
) {
  if (params.amountCents <= 0n) {
    return null;
  }

  const [existingTx] = await tx
    .select()
    .from(rewardLedgerTransactions)
    .where(eq(rewardLedgerTransactions.idempotencyKey, params.idempotencyKey))
    .limit(1);

  if (existingTx) {
    return { transaction: existingTx, alreadyExisted: true };
  }

  const wallet = await ensureAndLockWalletTx(tx, params.userId);
  const newAvailable = wallet.availableCents + params.amountCents;
  const newTotalEarned =
    params.incrementTotalEarned !== false
      ? wallet.totalEarnedCents + params.amountCents
      : wallet.totalEarnedCents;

  const amountFormatted = formatCentsToPoints(params.amountCents);
  const balanceBefore = formatCentsToPoints(wallet.availableCents);
  const balanceAfter = formatCentsToPoints(newAvailable);

  const [ledgerRow] = await tx
    .insert(rewardLedgerTransactions)
    .values({
      referenceCode: generateScopedReference('KTX'),
      idempotencyKey: params.idempotencyKey,
      walletId: wallet.id,
      userId: params.userId,
      transactionType: params.transactionType,
      direction: 'CREDIT',
      amountPoints: amountFormatted,
      signedPoints: amountFormatted,
      balanceBefore,
      balanceAfter,
      verificationId: params.verificationId ?? null,
      redemptionRequestId: params.redemptionRequestId ?? null,
      appliedRatePerKg: params.appliedRatePerKg ?? null,
      description: params.description,
      status: 'POSTED',
      actorUserId: params.actorUserId ?? null,
      isDemo: params.isDemo ?? false,
    })
    .returning();

  await tx
    .update(rewardWallets)
    .set({
      availablePoints: balanceAfter,
      totalEarnedPoints: formatCentsToPoints(newTotalEarned),
      updatedAt: new Date(),
    })
    .where(eq(rewardWallets.id, wallet.id));

  return { transaction: ledgerRow, alreadyExisted: false };
}

// ============================================================
// MATERIAL REWARD RATES (STAGE 4)
// ============================================================

export async function listRewardRatesAdmin() {
  try {
    const [cats, rates, admins] = await Promise.all([
      db
        .select({
          id: materialCategories.id,
          name: materialCategories.name,
          slug: materialCategories.slug,
          unit: materialCategories.unit,
          streamType: materialCategories.streamType,
          isActive: materialCategories.isActive,
        })
        .from(materialCategories)
        .orderBy(asc(materialCategories.displayOrder), asc(materialCategories.id)),
      db
        .select()
        .from(rewardRates)
        .orderBy(desc(rewardRates.effectiveFrom), desc(rewardRates.id)),
      db
        .select({ id: users.id, fullName: users.fullName, email: users.email })
        .from(users)
        .where(eq(users.role, 'ADMIN')),
    ]);

    const catMap = new Map(cats.map((c) => [c.id, c]));
    const adminMap = new Map(admins.map((a) => [a.id, a]));

    const history = rates.map((r) => ({
      id: r.id,
      materialCategoryId: r.materialCategoryId,
      materialName: catMap.get(r.materialCategoryId)?.name ?? 'Unknown Material',
      materialUnit: catMap.get(r.materialCategoryId)?.unit ?? 'kg',
      pointsPerKg: r.pointsPerKg,
      isActive: r.isActive,
      isDemo: r.isDemo,
      effectiveFrom: r.effectiveFrom,
      deactivatedAt: r.deactivatedAt,
      changedByAdminId: r.changedByAdminId,
      changedByAdminName: r.changedByAdminId
        ? adminMap.get(r.changedByAdminId)?.fullName ?? 'Administrator'
        : 'System Pilot Seed',
      reason: r.reason,
      createdAt: r.createdAt,
    }));

    const activeByMaterial = cats
      .filter((c) => c.streamType === 'RECYCLABLE')
      .map((c) => {
        const activeRate = history.find((h) => h.materialCategoryId === c.id && h.isActive) ?? null;
        return {
          materialCategoryId: c.id,
          materialName: c.name,
          materialSlug: c.slug,
          unit: c.unit,
          isCategoryActive: c.isActive,
          activeRate,
        };
      });

    return { activeByMaterial, history };
  } catch (error) {
    console.error('Database error in listRewardRatesAdmin:', error);
    throw new Error('Unable to load material reward rates.', { cause: error });
  }
}

export async function upsertMaterialRewardRateAdmin(
  adminId: number,
  input: {
    materialCategoryId: unknown;
    pointsPerKg: unknown;
    isDemo?: unknown;
    reason: unknown;
    effectiveFrom?: unknown;
  }
) {
  const categoryId = Number(input.materialCategoryId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new ValidationError('Select a valid recyclable material category.');
  }

  const rateCents = parsePointsToCents(input.pointsPerKg);
  if (rateCents === null || rateCents <= 0n) {
    throw new ValidationError('Points per kg must be greater than 0 (up to 2 decimal places).');
  }
  if (rateCents > 10000000n) {
    throw new ValidationError('Reward rate exceeds the permitted maximum per kilogram.');
  }

  if (typeof input.reason !== 'string' || input.reason.trim().length < 4) {
    throw new ValidationError('Provide a short administrative reason for this rate change.');
  }
  const reason = input.reason.trim().slice(0, 500);
  const isDemo = typeof input.isDemo === 'boolean' ? input.isDemo : true;
  const formattedRate = formatCentsToPoints(rateCents);

  let effectiveFrom = new Date();
  if (typeof input.effectiveFrom === 'string' && input.effectiveFrom.trim()) {
    const parsedDate = new Date(input.effectiveFrom);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new ValidationError('Effective timestamp is invalid.');
    }
    effectiveFrom = parsedDate;
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [cat] = await tx
        .select()
        .from(materialCategories)
        .where(eq(materialCategories.id, categoryId))
        .limit(1);

      if (!cat) {
        throw new NotFoundError('Material category not found.');
      }

      const now = new Date();
      await tx
        .update(rewardRates)
        .set({ isActive: false, deactivatedAt: now })
        .where(
          and(eq(rewardRates.materialCategoryId, categoryId), eq(rewardRates.isActive, true))
        );

      const [inserted] = await tx
        .insert(rewardRates)
        .values({
          materialCategoryId: categoryId,
          pointsPerKg: formattedRate,
          isActive: true,
          isDemo,
          effectiveFrom,
          changedByAdminId: adminId,
          reason,
        })
        .returning();

      await tx
        .update(materialCategories)
        .set({
          rewardRateDemo: formattedRate,
          isRateConfigured: true,
          updatedAt: now,
        })
        .where(eq(materialCategories.id, categoryId));

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'REWARD_RATE_UPDATED',
        targetType: 'REWARD_RATE',
        targetId: String(inserted.id),
        details: `${cat.name} set to ${formattedRate} pts/kg (${isDemo ? 'DEMO' : 'LIVE'}) — ${reason}`,
      });

      return inserted;
    });

    return created;
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }
    console.error('Database error in upsertMaterialRewardRateAdmin:', error);
    throw new Error('Could not update material reward rate.', { cause: error });
  }
}

export async function deactivateRewardRateAdmin(rateId: number, adminId: number, reason?: string) {
  try {
    return await db.transaction(async (tx) => {
      const [rate] = await tx
        .select()
        .from(rewardRates)
        .where(eq(rewardRates.id, rateId))
        .limit(1);

      if (!rate) {
        throw new NotFoundError('Reward rate record not found.');
      }
      if (!rate.isActive) {
        throw new ValidationError('This reward rate is already inactive.');
      }

      const now = new Date();
      const [updated] = await tx
        .update(rewardRates)
        .set({ isActive: false, deactivatedAt: now })
        .where(eq(rewardRates.id, rateId))
        .returning();

      await tx
        .update(materialCategories)
        .set({ isRateConfigured: false, updatedAt: now })
        .where(eq(materialCategories.id, rate.materialCategoryId));

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'REWARD_RATE_DEACTIVATED',
        targetType: 'REWARD_RATE',
        targetId: String(rateId),
        details: `Deactivated rate ${rate.pointsPerKg} pts/kg for category #${rate.materialCategoryId}${reason ? `: ${reason.trim()}` : ''}`,
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    console.error('Database error in deactivateRewardRateAdmin:', error);
    throw new Error('Could not deactivate reward rate.', { cause: error });
  }
}

// ============================================================
// USER WALLET & IMMUTABLE LEDGER
// ============================================================

export async function getRedemptionSettings() {
  try {
    const [existing] = await db.select().from(redemptionSettings).limit(1);
    if (existing) {
      let enabledMethods: RedemptionMethod[] = [
        'BITCOIN_LIGHTNING',
        'BANK_TRANSFER',
        'AIRTIME',
        'MOBILE_DATA',
        'CAMPUS_VOUCHER',
      ];
      try {
        const parsed = JSON.parse(existing.enabledMethodsJson);
        if (Array.isArray(parsed)) {
          enabledMethods = parsed.filter((m): m is RedemptionMethod =>
            ALLOWED_REDEMPTION_METHODS.has(m as RedemptionMethod)
          );
        }
      } catch {
        // default fallback
      }
      return {
        id: existing.id,
        minRedemptionPoints: existing.minRedemptionPoints,
        pointsToNgnRate: existing.pointsToNgnRate,
        pointsToSatsRate: existing.pointsToSatsRate,
        enabledMethods,
        failedRedemptionPolicy: existing.failedRedemptionPolicy,
        isDemoRates: existing.isDemoRates,
        updatedAt: existing.updatedAt,
      };
    }

    const [created] = await db.insert(redemptionSettings).values({}).returning();
    return {
      id: created.id,
      minRedemptionPoints: created.minRedemptionPoints,
      pointsToNgnRate: created.pointsToNgnRate,
      pointsToSatsRate: created.pointsToSatsRate,
      enabledMethods: [
        'BITCOIN_LIGHTNING',
        'BANK_TRANSFER',
        'AIRTIME',
        'MOBILE_DATA',
        'CAMPUS_VOUCHER',
      ] as RedemptionMethod[],
      failedRedemptionPolicy: created.failedRedemptionPolicy,
      isDemoRates: created.isDemoRates,
      updatedAt: created.updatedAt,
    };
  } catch (error) {
    console.error('Database error in getRedemptionSettings:', error);
    throw new Error('Unable to load redemption settings.', { cause: error });
  }
}

export async function updateRedemptionSettingsAdmin(
  adminId: number,
  input: {
    minRedemptionPoints?: unknown;
    pointsToNgnRate?: unknown;
    pointsToSatsRate?: unknown;
    enabledMethods?: unknown;
    isDemoRates?: unknown;
  }
) {
  const current = await getRedemptionSettings();

  let minPointsFormatted = current.minRedemptionPoints;
  if (input.minRedemptionPoints !== undefined) {
    const parsed = parsePointsToCents(input.minRedemptionPoints);
    if (parsed === null || parsed < 100n) {
      throw new ValidationError('Minimum redemption points must be at least 1.00 point.');
    }
    minPointsFormatted = formatCentsToPoints(parsed);
  }

  let ngnRateFormatted = current.pointsToNgnRate;
  if (input.pointsToNgnRate !== undefined) {
    const parsed = parseDecimalToScaledInt(input.pointsToNgnRate, 4);
    if (parsed === null || parsed <= 0n) {
      throw new ValidationError('Points-to-NGN conversion rate must be greater than 0.');
    }
    ngnRateFormatted = (Number(parsed) / 10000).toFixed(4);
  }

  let satsRateFormatted = current.pointsToSatsRate;
  if (input.pointsToSatsRate !== undefined) {
    const parsed = parseDecimalToScaledInt(input.pointsToSatsRate, 4);
    if (parsed === null || parsed <= 0n) {
      throw new ValidationError('Points-to-sats conversion rate must be greater than 0.');
    }
    satsRateFormatted = (Number(parsed) / 10000).toFixed(4);
  }

  let enabledMethods = current.enabledMethods;
  if (Array.isArray(input.enabledMethods)) {
    const filtered = input.enabledMethods.filter((m): m is RedemptionMethod =>
      ALLOWED_REDEMPTION_METHODS.has(m as RedemptionMethod)
    );
    if (filtered.length === 0) {
      throw new ValidationError('At least one redemption method must remain enabled.');
    }
    enabledMethods = filtered;
  }

  const isDemoRates =
    typeof input.isDemoRates === 'boolean' ? input.isDemoRates : current.isDemoRates;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(redemptionSettings)
        .set({
          minRedemptionPoints: minPointsFormatted,
          pointsToNgnRate: ngnRateFormatted,
          pointsToSatsRate: satsRateFormatted,
          enabledMethodsJson: JSON.stringify(enabledMethods),
          isDemoRates,
          updatedByAdminId: adminId,
          updatedAt: new Date(),
        })
        .where(eq(redemptionSettings.id, current.id));

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'REDEMPTION_SETTINGS_UPDATED',
        targetType: 'REDEMPTION_SETTINGS',
        targetId: String(current.id),
        details: `Min: ${minPointsFormatted} pts · NGN rate: ${ngnRateFormatted} · Sats rate: ${satsRateFormatted} · Methods: ${enabledMethods.join(', ')}`,
      });
    });

    return await getRedemptionSettings();
  } catch (error) {
    console.error('Database error in updateRedemptionSettingsAdmin:', error);
    throw new Error('Could not save redemption settings.', { cause: error });
  }
}

export async function getUserWalletWithLedger(userId: number, transactionTypeFilter?: string) {
  try {
    await db
      .insert(rewardWallets)
      .values({ userId })
      .onConflictDoNothing({ target: rewardWallets.userId });

    const [wallet] = await db
      .select()
      .from(rewardWallets)
      .where(eq(rewardWallets.userId, userId))
      .limit(1);

    const conditions = [eq(rewardLedgerTransactions.userId, userId)];
    if (transactionTypeFilter && transactionTypeFilter !== 'ALL') {
      conditions.push(eq(rewardLedgerTransactions.transactionType, transactionTypeFilter));
    }

    const [transactions, settings] = await Promise.all([
      db
        .select()
        .from(rewardLedgerTransactions)
        .where(and(...conditions))
        .orderBy(desc(rewardLedgerTransactions.createdAt), desc(rewardLedgerTransactions.id))
        .limit(200),
      getRedemptionSettings(),
    ]);

    const availableCents = parsePointsToCents(wallet?.availablePoints ?? '0.00') ?? 0n;
    const satsPreview = calculateEstimatedPayoutValue(availableCents, settings.pointsToSatsRate);
    const ngnPreview = calculateEstimatedPayoutValue(availableCents, settings.pointsToNgnRate);

    return {
      wallet: {
        id: wallet.id,
        userId: wallet.userId,
        availablePoints: wallet.availablePoints,
        totalEarnedPoints: wallet.totalEarnedPoints,
        totalRedeemedPoints: wallet.totalRedeemedPoints,
        pendingRedemptionPoints: wallet.pendingRedemptionPoints,
        estimatedSatsDemo: satsPreview.wholeSats,
        estimatedNgnDemo: ngnPreview.amountFormatted,
        updatedAt: wallet.updatedAt,
      },
      settings,
      transactions,
    };
  } catch (error) {
    console.error('Database error in getUserWalletWithLedger:', error);
    throw new Error('Unable to load reward wallet and transaction ledger.', { cause: error });
  }
}

/**
 * Admin manual wallet adjustment (credit or debit).
 * Strictly enforces mandatory reason, non-negative balance invariant, immutable ledger row, notification & audit log.
 */
export async function postAdminWalletAdjustment(
  adminId: number,
  input: {
    targetUserId: unknown;
    signedAmountPoints: unknown;
    reason: unknown;
  }
) {
  const targetUserId = Number(input.targetUserId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    throw new ValidationError('Select a valid user account for wallet adjustment.');
  }

  const deltaCents = parseSignedDecimalToScaledInt(input.signedAmountPoints, 2);
  if (deltaCents === null || deltaCents === 0n) {
    throw new ValidationError('Enter a non-zero point adjustment (e.g. 25.00 or -10.00).');
  }

  if (typeof input.reason !== 'string' || input.reason.trim().length < 5) {
    throw new ValidationError(
      'A clear administrative justification (at least 5 characters) is required for manual adjustments.'
    );
  }
  const reason = input.reason.trim().slice(0, 500);

  try {
    return await db.transaction(async (tx) => {
      const [targetUser] = await tx
        .select({ id: users.id, fullName: users.fullName, isDemo: users.isDemo })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (!targetUser) {
        throw new NotFoundError('Target user account not found.');
      }

      const wallet = await ensureAndLockWalletTx(tx, targetUserId);
      const nextAvailable = wallet.availableCents + deltaCents;
      if (nextAvailable < 0n) {
        throw new ValidationError(
          `Adjustment rejected: wallet balance cannot become negative (available: ${formatCentsToPoints(
            wallet.availableCents
          )} pts).`
        );
      }

      const isCredit = deltaCents > 0n;
      const absCents = isCredit ? deltaCents : -deltaCents;
      const direction: LedgerDirection = isCredit ? 'CREDIT' : 'DEBIT';
      const balanceBefore = formatCentsToPoints(wallet.availableCents);
      const balanceAfter = formatCentsToPoints(nextAvailable);
      const nextTotalEarned = isCredit
        ? wallet.totalEarnedCents + absCents
        : wallet.totalEarnedCents;

      const [ledgerTx] = await tx
        .insert(rewardLedgerTransactions)
        .values({
          referenceCode: generateScopedReference('KTX'),
          idempotencyKey: `admin_adjustment:${adminId}:${targetUserId}:${Date.now()}:${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          walletId: wallet.id,
          userId: targetUserId,
          transactionType: 'ADMIN_ADJUSTMENT',
          direction,
          amountPoints: formatCentsToPoints(absCents),
          signedPoints: formatCentsToPoints(deltaCents),
          balanceBefore,
          balanceAfter,
          description: `Administrator adjustment: ${reason}`,
          status: 'POSTED',
          actorUserId: adminId,
          isDemo: targetUser.isDemo,
        })
        .returning();

      await tx
        .update(rewardWallets)
        .set({
          availablePoints: balanceAfter,
          totalEarnedPoints: formatCentsToPoints(nextTotalEarned),
          updatedAt: new Date(),
        })
        .where(eq(rewardWallets.id, wallet.id));

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'WALLET_ADMIN_ADJUSTMENT',
        targetType: 'REWARD_WALLET',
        targetId: String(wallet.id),
        details: `User #${targetUserId} (${targetUser.fullName}): ${formatCentsToPoints(
          deltaCents
        )} pts (${balanceBefore} -> ${balanceAfter}). Reason: ${reason}`,
      });

      await createNotificationTx(tx, {
        userId: targetUserId,
        eventType: 'ADMIN_ADJUSTMENT',
        title: isCredit ? 'Wallet balance adjusted (+)' : 'Wallet balance adjusted (-)',
        message: `An administrator adjusted your wallet by ${
          isCredit ? '+' : ''
        }${formatCentsToPoints(deltaCents)} pts. Reason: ${reason}`,
        actionRoute: '/wallet',
        relatedType: 'LEDGER_TX',
        relatedId: String(ledgerTx.id),
      });

      return ledgerTx;
    });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      throw error;
    }
    console.error('Database error in postAdminWalletAdjustment:', error);
    throw new Error('Could not process wallet adjustment.', { cause: error });
  }
}

// ============================================================
// REDEMPTION WORKFLOW (STAGE 4 — ATOMIC BALANCE RESERVATION)
// ============================================================

async function hydrateRedemptionRequests(
  rows: Array<typeof redemptionRequests.$inferSelect>
) {
  if (!rows.length) return [];

  const reqIds = rows.map((r) => r.id);
  const userIds = new Set<number>();
  for (const r of rows) {
    userIds.add(r.userId);
    if (r.reviewedByAdminId) userIds.add(r.reviewedByAdminId);
    if (r.processedByAdminId) userIds.add(r.processedByAdminId);
  }

  const historyRows = await db
    .select()
    .from(redemptionStatusHistory)
    .where(inArray(redemptionStatusHistory.redemptionRequestId, reqIds))
    .orderBy(asc(redemptionStatusHistory.createdAt), asc(redemptionStatusHistory.id));

  for (const h of historyRows) {
    if (h.changedByUserId) userIds.add(h.changedByUserId);
  }

  const userList = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email })
    .from(users)
    .where(inArray(users.id, Array.from(userIds)));

  const userMap = new Map(userList.map((u) => [u.id, u]));
  const historyMap = new Map<number, typeof historyRows>();
  for (const h of historyRows) {
    const arr = historyMap.get(h.redemptionRequestId) ?? [];
    arr.push(h);
    historyMap.set(h.redemptionRequestId, arr);
  }

  return rows.map((r) => {
    const owner = userMap.get(r.userId);
    let destinationDetails: Record<string, string> = {};
    try {
      destinationDetails = JSON.parse(r.destinationDetailsJson);
    } catch {
      destinationDetails = {};
    }

    return {
      id: r.id,
      referenceCode: r.referenceCode,
      userId: r.userId,
      userName: owner?.fullName ?? 'Participant',
      userEmail: owner?.email ?? '',
      pointsRequested: r.pointsRequested,
      method: r.method as RedemptionMethod,
      destinationSummary: r.destinationSummary,
      destinationDetails,
      estimatedValueAmount: r.estimatedValueAmount,
      estimatedValueUnit: r.estimatedValueUnit,
      conversionRateApplied: r.conversionRateApplied,
      status: r.status as RedemptionStatus,
      statusReason: r.statusReason,
      payoutReference: r.payoutReference,
      reviewedByAdminName: r.reviewedByAdminId
        ? userMap.get(r.reviewedByAdminId)?.fullName ?? 'Administrator'
        : null,
      processedByAdminName: r.processedByAdminId
        ? userMap.get(r.processedByAdminId)?.fullName ?? 'Administrator'
        : null,
      reviewedAt: r.reviewedAt,
      paidAt: r.paidAt,
      isDemo: r.isDemo,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      history: (historyMap.get(r.id) ?? []).map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedByName: h.changedByUserId
          ? userMap.get(h.changedByUserId)?.fullName ?? 'System'
          : 'System',
        note: h.note,
        payoutReference: h.payoutReference,
        createdAt: h.createdAt,
      })),
    };
  });
}

export async function createRedemptionRequest(
  user: SafeUserContext,
  input: {
    pointsRequested: unknown;
    method: unknown;
    destinationDetails: unknown;
  }
) {
  const pointsCents = parsePointsToCents(input.pointsRequested);
  if (pointsCents === null || pointsCents <= 0n) {
    throw new ValidationError('Enter a valid positive number of points to redeem (up to 2 decimal places).');
  }

  if (
    typeof input.method !== 'string' ||
    !ALLOWED_REDEMPTION_METHODS.has(input.method as RedemptionMethod)
  ) {
    throw new ValidationError('Select a supported redemption method.');
  }
  const method = input.method as RedemptionMethod;

  const rawDetails =
    input.destinationDetails && typeof input.destinationDetails === 'object'
      ? (input.destinationDetails as Record<string, unknown>)
      : {};
  const destCheck = validateRedemptionDestination(method, rawDetails);
  if (!destCheck.ok) {
    throw new ValidationError(destCheck.error);
  }

  const settings = await getRedemptionSettings();
  if (!settings.enabledMethods.includes(method)) {
    throw new ValidationError(`The ${method.replace(/_/g, ' ')} method is currently disabled by administrators.`);
  }

  const minCents = parsePointsToCents(settings.minRedemptionPoints) ?? 5000n;
  if (pointsCents < minCents) {
    throw new ValidationError(
      `Minimum redemption amount is ${formatCentsToPoints(minCents)} points.`
    );
  }

  const isLightning = method === 'BITCOIN_LIGHTNING';
  const appliedRate = isLightning ? settings.pointsToSatsRate : settings.pointsToNgnRate;
  const estimate = calculateEstimatedPayoutValue(pointsCents, appliedRate);
  const estimatedUnit = isLightning
    ? settings.isDemoRates
      ? 'SATS (DEMO)'
      : 'SATS'
    : settings.isDemoRates
      ? 'NGN (DEMO)'
      : 'NGN';
  const estimatedAmount = isLightning ? `${estimate.wholeSats}.00` : estimate.amountFormatted;

  try {
    const createdRow = await db.transaction(async (tx) => {
      // Acquire row-level lock on user's wallet to prevent concurrent double-spend!
      const wallet = await ensureAndLockWalletTx(tx, user.id);

      if (wallet.availableCents < pointsCents) {
        throw new ValidationError(
          `Insufficient available balance. Available: ${formatCentsToPoints(
            wallet.availableCents
          )} pts, Requested: ${formatCentsToPoints(pointsCents)} pts.`
        );
      }

      const nextAvailable = wallet.availableCents - pointsCents;
      const nextPending = wallet.pendingRedemptionCents + pointsCents;
      const pointsFormatted = formatCentsToPoints(pointsCents);
      const balanceBefore = formatCentsToPoints(wallet.availableCents);
      const balanceAfter = formatCentsToPoints(nextAvailable);
      const referenceCode = generateScopedReference('KRD');

      const [redemption] = await tx
        .insert(redemptionRequests)
        .values({
          referenceCode,
          userId: user.id,
          walletId: wallet.id,
          pointsRequested: pointsFormatted,
          method,
          destinationSummary: destCheck.value.summary,
          destinationDetailsJson: JSON.stringify(destCheck.value.details),
          estimatedValueAmount: estimatedAmount,
          estimatedValueUnit: estimatedUnit,
          conversionRateApplied: appliedRate,
          status: 'PENDING',
          isDemo: user.isDemo || settings.isDemoRates,
        })
        .returning();

      // Reserve balance & record immutable ledger DEBIT atomically
      await tx
        .update(rewardWallets)
        .set({
          availablePoints: balanceAfter,
          pendingRedemptionPoints: formatCentsToPoints(nextPending),
          updatedAt: new Date(),
        })
        .where(eq(rewardWallets.id, wallet.id));

      await tx.insert(rewardLedgerTransactions).values({
        referenceCode: generateScopedReference('KTX'),
        idempotencyKey: `redemption_debit:${redemption.id}`,
        walletId: wallet.id,
        userId: user.id,
        transactionType: 'REDEMPTION',
        direction: 'DEBIT',
        amountPoints: pointsFormatted,
        signedPoints: `-${pointsFormatted}`,
        balanceBefore,
        balanceAfter,
        redemptionRequestId: redemption.id,
        description: `Redemption ${referenceCode} reserved (${method.replace(/_/g, ' ')} · ${destCheck.value.summary})`,
        status: 'POSTED',
        actorUserId: user.id,
        isDemo: redemption.isDemo,
      });

      await tx.insert(redemptionStatusHistory).values({
        redemptionRequestId: redemption.id,
        fromStatus: null,
        toStatus: 'PENDING',
        changedByUserId: user.id,
        note: 'Redemption request submitted and points reserved from available balance.',
      });

      await tx.insert(auditLogs).values({
        actorUserId: user.id,
        action: 'REDEMPTION_REQUEST_CREATED',
        targetType: 'REDEMPTION_REQUEST',
        targetId: String(redemption.id),
        details: `${referenceCode} · ${pointsFormatted} pts · ${method} · est ${estimatedAmount} ${estimatedUnit}`,
      });

      await createNotificationTx(tx, {
        userId: user.id,
        eventType: 'REDEMPTION_SUBMITTED',
        title: 'Redemption request submitted',
        message: `Your request ${referenceCode} for ${pointsFormatted} pts (${method.replace(
          /_/g,
          ' '
        )}) is pending administrator review. Points have been reserved from your available balance.`,
        actionRoute: '/wallet',
        relatedType: 'REDEMPTION_REQUEST',
        relatedId: String(redemption.id),
      });

      await notifyActiveAdminsTx(tx, {
        eventType: 'ADMIN_PENDING_REDEMPTION',
        title: 'New redemption request pending review',
        message: `${user.fullName} requested ${pointsFormatted} pts via ${method.replace(
          /_/g,
          ' '
        )} (${referenceCode}).`,
        actionRoute: '/admin',
        relatedType: 'REDEMPTION_REQUEST',
        relatedId: String(redemption.id),
      });

      return redemption;
    });

    const [hydrated] = await hydrateRedemptionRequests([createdRow]);
    return hydrated;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    console.error('Database error in createRedemptionRequest:', error);
    throw new Error('Could not submit redemption request right now.', { cause: error });
  }
}

export async function listUserRedemptions(userId: number) {
  try {
    const rows = await db
      .select()
      .from(redemptionRequests)
      .where(eq(redemptionRequests.userId, userId))
      .orderBy(desc(redemptionRequests.createdAt), desc(redemptionRequests.id));
    return await hydrateRedemptionRequests(rows);
  } catch (error) {
    console.error('Database error in listUserRedemptions:', error);
    throw new Error('Unable to load your redemption history.', { cause: error });
  }
}

export async function cancelUserRedemption(
  redemptionId: number,
  userId: number,
  reason?: string
) {
  try {
    const updatedRow = await db.transaction(async (tx) => {
      const lockedRes = await tx.execute(
        sql`SELECT * FROM redemption_requests WHERE id = ${redemptionId} FOR UPDATE`
      );
      if (!lockedRes.rows.length) {
        throw new NotFoundError('Redemption request not found.');
      }

      const [existing] = await tx
        .select()
        .from(redemptionRequests)
        .where(eq(redemptionRequests.id, redemptionId))
        .limit(1);

      if (!existing) throw new NotFoundError('Redemption request not found.');
      if (existing.userId !== userId) {
        throw new ForbiddenError('You can only cancel your own redemption requests.');
      }
      if (existing.status !== 'PENDING') {
        throw new ValidationError(
          `Only PENDING redemptions can be cancelled by the participant (current: ${existing.status}).`
        );
      }

      const wallet = await ensureAndLockWalletTx(tx, userId);
      const ptsCents = parsePointsToCents(existing.pointsRequested) ?? 0n;
      const nextAvailable = wallet.availableCents + ptsCents;
      const nextPending =
        wallet.pendingRedemptionCents >= ptsCents
          ? wallet.pendingRedemptionCents - ptsCents
          : 0n;

      const balanceBefore = formatCentsToPoints(wallet.availableCents);
      const balanceAfter = formatCentsToPoints(nextAvailable);
      const cancelNote = reason?.trim() || 'Cancelled by participant before approval';

      const [updated] = await tx
        .update(redemptionRequests)
        .set({
          status: 'CANCELLED',
          statusReason: cancelNote,
          updatedAt: new Date(),
        })
        .where(eq(redemptionRequests.id, redemptionId))
        .returning();

      await tx
        .update(rewardWallets)
        .set({
          availablePoints: balanceAfter,
          pendingRedemptionPoints: formatCentsToPoints(nextPending),
          updatedAt: new Date(),
        })
        .where(eq(rewardWallets.id, wallet.id));

      await tx.insert(rewardLedgerTransactions).values({
        referenceCode: generateScopedReference('KTX'),
        idempotencyKey: `redemption_reversal:${redemptionId}`,
        walletId: wallet.id,
        userId,
        transactionType: 'REVERSAL',
        direction: 'CREDIT',
        amountPoints: existing.pointsRequested,
        signedPoints: existing.pointsRequested,
        balanceBefore,
        balanceAfter,
        redemptionRequestId: redemptionId,
        description: `Reversal for cancelled redemption ${existing.referenceCode}`,
        status: 'POSTED',
        actorUserId: userId,
        isDemo: existing.isDemo,
      });

      await tx.insert(redemptionStatusHistory).values({
        redemptionRequestId: redemptionId,
        fromStatus: 'PENDING',
        toStatus: 'CANCELLED',
        changedByUserId: userId,
        note: cancelNote,
      });

      await tx.insert(auditLogs).values({
        actorUserId: userId,
        action: 'REDEMPTION_CANCELLED',
        targetType: 'REDEMPTION_REQUEST',
        targetId: String(redemptionId),
        details: `${existing.referenceCode} cancelled; ${existing.pointsRequested} pts returned to wallet`,
      });

      await createNotificationTx(tx, {
        userId,
        eventType: 'REDEMPTION_CANCELLED',
        title: 'Redemption cancelled — points returned',
        message: `${existing.referenceCode} was cancelled and ${existing.pointsRequested} pts have been returned to your available balance.`,
        actionRoute: '/wallet',
        relatedType: 'REDEMPTION_REQUEST',
        relatedId: String(redemptionId),
      });

      return updated;
    });

    const [hydrated] = await hydrateRedemptionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    console.error('Database error in cancelUserRedemption:', error);
    throw new Error('Could not cancel redemption request.', { cause: error });
  }
}

export async function listAllRedemptionsAdmin(filters?: {
  status?: string;
  method?: string;
  search?: string;
}) {
  try {
    const conditions = [];
    if (filters?.status && filters.status !== 'ALL') {
      conditions.push(eq(redemptionRequests.status, filters.status));
    }
    if (filters?.method && filters.method !== 'ALL') {
      conditions.push(eq(redemptionRequests.method, filters.method));
    }

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(redemptionRequests)
            .where(and(...conditions))
            .orderBy(desc(redemptionRequests.createdAt), desc(redemptionRequests.id))
        : await db
            .select()
            .from(redemptionRequests)
            .orderBy(desc(redemptionRequests.createdAt), desc(redemptionRequests.id));

    const hydrated = await hydrateRedemptionRequests(rows);
    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      return hydrated.filter(
        (r) =>
          r.referenceCode.toLowerCase().includes(q) ||
          r.userName.toLowerCase().includes(q) ||
          r.userEmail.toLowerCase().includes(q) ||
          r.destinationSummary.toLowerCase().includes(q) ||
          (r.payoutReference ?? '').toLowerCase().includes(q)
      );
    }
    return hydrated;
  } catch (error) {
    console.error('Database error in listAllRedemptionsAdmin:', error);
    throw new Error('Unable to load redemption requests.', { cause: error });
  }
}

export async function listRecentLedgerTransactionsAdmin(limit = 100) {
  try {
    const rows = await db
      .select()
      .from(rewardLedgerTransactions)
      .orderBy(desc(rewardLedgerTransactions.createdAt), desc(rewardLedgerTransactions.id))
      .limit(limit);

    if (!rows.length) return [];

    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const userList = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));
    const userMap = new Map(userList.map((u) => [u.id, u]));

    return rows.map((r) => ({
      ...r,
      userName: userMap.get(r.userId)?.fullName ?? 'Participant',
      userEmail: userMap.get(r.userId)?.email ?? '',
    }));
  } catch (error) {
    console.error('Database error in listRecentLedgerTransactionsAdmin:', error);
    throw new Error('Unable to load reward ledger transactions.', { cause: error });
  }
}

/**
 * Transitions a redemption request safely with row locking, strict state machine validation,
 * mandatory payout confirmation reference for PAID, and automatic idempotent REVERSAL on REJECTED/FAILED.
 */
export async function transitionRedemptionStatusAdmin(
  redemptionId: number,
  adminId: number,
  input: {
    nextStatus: unknown;
    note?: unknown;
    payoutReference?: unknown;
  }
) {
  const allowedNext = new Set<RedemptionStatus>([
    'APPROVED',
    'REJECTED',
    'PROCESSING',
    'PAID',
    'FAILED',
  ]);
  if (
    typeof input.nextStatus !== 'string' ||
    !allowedNext.has(input.nextStatus as RedemptionStatus)
  ) {
    throw new ValidationError('Next status must be APPROVED, REJECTED, PROCESSING, PAID, or FAILED.');
  }
  const nextStatus = input.nextStatus as RedemptionStatus;
  const note =
    typeof input.note === 'string' && input.note.trim().length > 0
      ? input.note.trim().slice(0, 600)
      : null;
  const payoutReference =
    typeof input.payoutReference === 'string' && input.payoutReference.trim().length > 0
      ? input.payoutReference.trim().slice(0, 160)
      : null;

  if ((nextStatus === 'REJECTED' || nextStatus === 'FAILED') && !note) {
    throw new ValidationError(
      `Provide a clear reason when marking a redemption as ${nextStatus}.`
    );
  }
  if (nextStatus === 'PAID' && !payoutReference) {
    throw new ValidationError(
      'A confirmed payout reference or transaction receipt ID is required before marking a redemption as PAID.'
    );
  }

  try {
    const updatedRow = await db.transaction(async (tx) => {
      const lockRes = await tx.execute(
        sql`SELECT id FROM redemption_requests WHERE id = ${redemptionId} FOR UPDATE`
      );
      if (!lockRes.rows.length) {
        throw new NotFoundError('Redemption request not found.');
      }

      const [existing] = await tx
        .select()
        .from(redemptionRequests)
        .where(eq(redemptionRequests.id, redemptionId))
        .limit(1);

      if (!existing) throw new NotFoundError('Redemption request not found.');

      const fromStatus = existing.status as RedemptionStatus;
      if (!canTransitionRedemptionStatus(fromStatus, nextStatus)) {
        throw new ValidationError(
          `Cannot transition redemption ${existing.referenceCode} from ${fromStatus} to ${nextStatus}.`
        );
      }

      const now = new Date();
      const wallet = await ensureAndLockWalletTx(tx, existing.userId);
      const ptsCents = parsePointsToCents(existing.pointsRequested) ?? 0n;

      if (nextStatus === 'PAID') {
        const nextPending =
          wallet.pendingRedemptionCents >= ptsCents
            ? wallet.pendingRedemptionCents - ptsCents
            : 0n;
        const nextRedeemed = wallet.totalRedeemedCents + ptsCents;

        await tx
          .update(rewardWallets)
          .set({
            pendingRedemptionPoints: formatCentsToPoints(nextPending),
            totalRedeemedPoints: formatCentsToPoints(nextRedeemed),
            updatedAt: now,
          })
          .where(eq(rewardWallets.id, wallet.id));
      } else if (nextStatus === 'REJECTED' || nextStatus === 'FAILED') {
        // Automatic balance release & immutable REVERSAL credit (idempotent)
        const [existingReversal] = await tx
          .select({ id: rewardLedgerTransactions.id })
          .from(rewardLedgerTransactions)
          .where(
            eq(rewardLedgerTransactions.idempotencyKey, `redemption_reversal:${redemptionId}`)
          )
          .limit(1);

        if (!existingReversal) {
          const nextAvailable = wallet.availableCents + ptsCents;
          const nextPending =
            wallet.pendingRedemptionCents >= ptsCents
              ? wallet.pendingRedemptionCents - ptsCents
              : 0n;
          const balanceBefore = formatCentsToPoints(wallet.availableCents);
          const balanceAfter = formatCentsToPoints(nextAvailable);

          await tx
            .update(rewardWallets)
            .set({
              availablePoints: balanceAfter,
              pendingRedemptionPoints: formatCentsToPoints(nextPending),
              updatedAt: now,
            })
            .where(eq(rewardWallets.id, wallet.id));

          await tx.insert(rewardLedgerTransactions).values({
            referenceCode: generateScopedReference('KTX'),
            idempotencyKey: `redemption_reversal:${redemptionId}`,
            walletId: wallet.id,
            userId: existing.userId,
            transactionType: 'REVERSAL',
            direction: 'CREDIT',
            amountPoints: existing.pointsRequested,
            signedPoints: existing.pointsRequested,
            balanceBefore,
            balanceAfter,
            redemptionRequestId: redemptionId,
            description:
              nextStatus === 'REJECTED'
                ? `Reversal for rejected redemption ${existing.referenceCode}: ${note}`
                : `Auto-refund reversal for failed payout ${existing.referenceCode}: ${note}`,
            status: 'POSTED',
            actorUserId: adminId,
            isDemo: existing.isDemo,
          });
        }
      }

      const [updated] = await tx
        .update(redemptionRequests)
        .set({
          status: nextStatus,
          statusReason: note ?? existing.statusReason,
          payoutReference: payoutReference ?? existing.payoutReference,
          reviewedByAdminId:
            nextStatus === 'APPROVED' || nextStatus === 'REJECTED'
              ? adminId
              : existing.reviewedByAdminId,
          reviewedAt:
            nextStatus === 'APPROVED' || nextStatus === 'REJECTED' ? now : existing.reviewedAt,
          processedByAdminId:
            nextStatus === 'PROCESSING' || nextStatus === 'PAID' || nextStatus === 'FAILED'
              ? adminId
              : existing.processedByAdminId,
          paidAt: nextStatus === 'PAID' ? now : existing.paidAt,
          updatedAt: now,
        })
        .where(eq(redemptionRequests.id, redemptionId))
        .returning();

      await tx.insert(redemptionStatusHistory).values({
        redemptionRequestId: redemptionId,
        fromStatus,
        toStatus: nextStatus,
        changedByUserId: adminId,
        note: note ?? `Marked ${nextStatus} by administrator`,
        payoutReference,
      });

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: `REDEMPTION_${nextStatus}`,
        targetType: 'REDEMPTION_REQUEST',
        targetId: String(redemptionId),
        details: `${existing.referenceCode} moved ${fromStatus} -> ${nextStatus}${
          payoutReference ? ` · Ref: ${payoutReference}` : ''
        }${note ? ` · ${note}` : ''}`,
      });

      // Notify user for every redemption transition
      if (nextStatus === 'APPROVED') {
        await createNotificationTx(tx, {
          userId: existing.userId,
          eventType: 'REDEMPTION_APPROVED',
          title: 'Redemption approved',
          message: `Your redemption ${existing.referenceCode} (${existing.pointsRequested} pts) was approved and is queued for payout processing.`,
          actionRoute: '/wallet',
          relatedType: 'REDEMPTION_REQUEST',
          relatedId: String(redemptionId),
        });
      } else if (nextStatus === 'REJECTED') {
        await createNotificationTx(tx, {
          userId: existing.userId,
          eventType: 'REDEMPTION_REJECTED',
          title: 'Redemption rejected — points returned',
          message: `Your redemption ${existing.referenceCode} was rejected (${note}). ${existing.pointsRequested} pts have been returned to your available wallet balance.`,
          actionRoute: '/wallet',
          relatedType: 'REDEMPTION_REQUEST',
          relatedId: String(redemptionId),
        });
      } else if (nextStatus === 'PROCESSING') {
        await createNotificationTx(tx, {
          userId: existing.userId,
          eventType: 'REDEMPTION_PROCESSED',
          title: 'Redemption payout in progress',
          message: `Your redemption ${existing.referenceCode} (${existing.pointsRequested} pts) is now being processed.`,
          actionRoute: '/wallet',
          relatedType: 'REDEMPTION_REQUEST',
          relatedId: String(redemptionId),
        });
      } else if (nextStatus === 'PAID') {
        await createNotificationTx(tx, {
          userId: existing.userId,
          eventType: 'REDEMPTION_PROCESSED',
          title: 'Redemption paid & confirmed',
          message: `Your redemption ${existing.referenceCode} (${existing.pointsRequested} pts) has been marked PAID. Reference: ${payoutReference}.`,
          actionRoute: '/wallet',
          relatedType: 'REDEMPTION_REQUEST',
          relatedId: String(redemptionId),
        });
      } else if (nextStatus === 'FAILED') {
        await createNotificationTx(tx, {
          userId: existing.userId,
          eventType: 'REDEMPTION_FAILED',
          title: 'Redemption payout failed — points refunded',
          message: `Payout for ${existing.referenceCode} failed (${note}). Per KILN policy, ${existing.pointsRequested} pts have been automatically returned to your available balance.`,
          actionRoute: '/wallet',
          relatedType: 'REDEMPTION_REQUEST',
          relatedId: String(redemptionId),
        });
      }

      return updated;
    });

    const [hydrated] = await hydrateRedemptionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    console.error('Database error in transitionRedemptionStatusAdmin:', error);
    throw new Error('Could not update redemption status.', { cause: error });
  }
}
