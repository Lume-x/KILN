import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  collectionAgentProfiles,
  collectionRequests,
  inventoryEntries,
  learningCompletions,
  learningModules,
  materialBatches,
  materialCategories,
  materialSales,
  materialTransfers,
  redemptionRequests,
  rewardLedgerTransactions,
  rewardWallets,
  userProfiles,
  users,
  wasteSubmissions,
  weightVerifications,
  type MaterialStreamType,
  type UserRole,
} from './schema.ts';
import { formatCentigramsToKg, parseCentigrams, slugifyName } from '../lib/collection-rules.ts';
import {
  buildCsvDocument,
  formatCentsToPoints,
  parsePointsToCents,
} from '../lib/rewards-rules.ts';
import { NotFoundError, ValidationError } from './collection-repository.ts';

// ============================================================
// STAGE 8: ADMIN DASHBOARD OVERVIEW (100% REAL DB METRICS)
// ============================================================

export async function getAdminDashboardOverview() {
  try {
    const [
      allUsers,
      allRequests,
      allVerifications,
      allLedger,
      allRedemptions,
      allEntries,
      allBatches,
      allTransfers,
      allSales,
      allCompletions,
    ] = await Promise.all([
      db.select({ id: users.id, role: users.role, isActive: users.isActive, isDemo: users.isDemo }).from(users),
      db.select({ id: collectionRequests.id, status: collectionRequests.status, isDemo: collectionRequests.isDemo }).from(collectionRequests),
      db.select({ id: weightVerifications.id, decision: weightVerifications.decision, verifiedEligibleWeightKg: weightVerifications.verifiedEligibleWeightKg, pointsAwarded: weightVerifications.pointsAwarded }).from(weightVerifications),
      db.select({ transactionType: rewardLedgerTransactions.transactionType, amountPoints: rewardLedgerTransactions.amountPoints }).from(rewardLedgerTransactions),
      db.select({ status: redemptionRequests.status, pointsRequested: redemptionRequests.pointsRequested }).from(redemptionRequests),
      db.select({ availableWeightKg: inventoryEntries.availableWeightKg }).from(inventoryEntries),
      db.select({ availableWeightKg: materialBatches.availableWeightKg, status: materialBatches.status }).from(materialBatches),
      db.select({ id: materialTransfers.id, status: materialTransfers.status }).from(materialTransfers),
      db.select({ quantityKg: materialSales.quantityKg, totalValueNgn: materialSales.totalValueNgn, transferStatus: materialSales.transferStatus, paymentStatus: materialSales.paymentStatus }).from(materialSales),
      db.select({ passed: learningCompletions.passed, bonusPointsAwarded: learningCompletions.bonusPointsAwarded }).from(learningCompletions),
    ]);

    let verifiedKgCg = 0;
    let approvedVerifications = 0;
    for (const v of allVerifications) {
      if (v.decision === 'APPROVED') {
        approvedVerifications += 1;
        verifiedKgCg += parseCentigrams(v.verifiedEligibleWeightKg) ?? 0;
      }
    }

    let pointsCreditedCents = 0n;
    for (const tx of allLedger) {
      if (tx.transactionType === 'COLLECTION_REWARD' || tx.transactionType === 'LEARNING_BONUS') {
        pointsCreditedCents += parsePointsToCents(tx.amountPoints) ?? 0n;
      }
    }

    let pendingRedemptions = 0;
    let paidRedemptions = 0;
    let paidRedemptionPointsCents = 0n;
    for (const r of allRedemptions) {
      if (r.status === 'PENDING' || r.status === 'APPROVED' || r.status === 'PROCESSING') {
        pendingRedemptions += 1;
      }
      if (r.status === 'PAID') {
        paidRedemptions += 1;
        paidRedemptionPointsCents += parsePointsToCents(r.pointsRequested) ?? 0n;
      }
    }

    let inventoryAvailableCg = 0;
    for (const e of allEntries) inventoryAvailableCg += parseCentigrams(e.availableWeightKg) ?? 0;
    for (const b of allBatches) inventoryAvailableCg += parseCentigrams(b.availableWeightKg) ?? 0;

    let totalSoldKgCg = 0;
    let totalPaidSalesCents = 0n;
    for (const s of allSales) {
      if (s.transferStatus !== 'CANCELLED') {
        totalSoldKgCg += parseCentigrams(s.quantityKg) ?? 0;
      }
      if (s.paymentStatus === 'PAID') {
        totalPaidSalesCents += parsePointsToCents(s.totalValueNgn) ?? 0n;
      }
    }

    return {
      totalRegisteredUsers: allUsers.length,
      activeAgents: allUsers.filter((u) => u.role === 'AGENT' && u.isActive).length,
      totalCollectionRequests: allRequests.length,
      pendingRequests: allRequests.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED').length,
      completedCollections: allRequests.filter((r) => r.status === 'VERIFIED').length,
      pendingVerifications: allRequests.filter((r) => r.status === 'AWAITING_VERIFICATION').length,
      approvedVerifications,
      verifiedMaterialKg: formatCentigramsToKg(verifiedKgCg),
      totalRewardPointsIssued: formatCentsToPoints(pointsCreditedCents),
      pendingRedemptions,
      paidRedemptions,
      totalPointsRedeemed: formatCentsToPoints(paidRedemptionPointsCents),
      availableInventoryKg: formatCentigramsToKg(inventoryAvailableCg),
      totalBatches: allBatches.length,
      totalTransfers: allTransfers.length,
      totalSalesCount: allSales.length,
      totalSoldKg: formatCentigramsToKg(totalSoldKgCg),
      totalPaidSalesNgn: formatCentsToPoints(totalPaidSalesCents),
      learningCompletionsPassed: allCompletions.filter((c) => c.passed).length,
    };
  } catch (error) {
    console.error('Database error in getAdminDashboardOverview:', error);
    throw new Error('Unable to load administrator dashboard metrics.', { cause: error });
  }
}

// ============================================================
// STAGE 8: USER MANAGEMENT
// ============================================================

export async function listUsersAdmin(filters?: { search?: string; role?: string }) {
  try {
    const [userRows, profiles, agentProfiles, wallets] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          phoneNumber: users.phoneNumber,
          role: users.role,
          isActive: users.isActive,
          isDemo: users.isDemo,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt), desc(users.id)),
      db.select().from(userProfiles),
      db.select().from(collectionAgentProfiles),
      db.select().from(rewardWallets),
    ]);

    const profMap = new Map(profiles.map((p) => [p.userId, p]));
    const agentMap = new Map(agentProfiles.map((a) => [a.userId, a]));
    const walletMap = new Map(wallets.map((w) => [w.userId, w]));

    let combined = userRows.map((u) => {
      const prof = profMap.get(u.id);
      const ag = agentMap.get(u.id);
      const wal = walletMap.get(u.id);
      return {
        ...u,
        communityArea: prof?.communityArea ?? 'FUTO Campus',
        hasNostrPubkey: Boolean(prof?.nostrPubkey),
        serviceZone: ag?.serviceZone ?? null,
        agentAvailable: ag?.isAvailable ?? null,
        availablePoints: wal?.availablePoints ?? '0.00',
        totalEarnedPoints: wal?.totalEarnedPoints ?? '0.00',
        totalRedeemedPoints: wal?.totalRedeemedPoints ?? '0.00',
        pendingRedemptionPoints: wal?.pendingRedemptionPoints ?? '0.00',
      };
    });

    if (filters?.role && filters.role !== 'ALL') {
      combined = combined.filter((u) => u.role === filters.role);
    }
    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      combined = combined.filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.communityArea.toLowerCase().includes(q)
      );
    }
    return combined;
  } catch (error) {
    console.error('Database error in listUsersAdmin:', error);
    throw new Error('Unable to load user directory.', { cause: error });
  }
}

export async function getUserDetailAdmin(targetUserId: number) {
  try {
    const [u] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        phoneNumber: users.phoneNumber,
        role: users.role,
        isActive: users.isActive,
        isDemo: users.isDemo,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!u) throw new NotFoundError('User account not found.');

    const [profile, wallet, requests, ledger, redemptions, completions] = await Promise.all([
      db.select().from(userProfiles).where(eq(userProfiles.userId, targetUserId)).limit(1),
      db.select().from(rewardWallets).where(eq(rewardWallets.userId, targetUserId)).limit(1),
      db
        .select({
          id: collectionRequests.id,
          referenceCode: collectionRequests.referenceCode,
          status: collectionRequests.status,
          estimatedWeightKg: collectionRequests.estimatedWeightKg,
          collectionMethod: collectionRequests.collectionMethod,
          createdAt: collectionRequests.createdAt,
        })
        .from(collectionRequests)
        .where(eq(collectionRequests.userId, targetUserId))
        .orderBy(desc(collectionRequests.createdAt))
        .limit(20),
      db
        .select()
        .from(rewardLedgerTransactions)
        .where(eq(rewardLedgerTransactions.userId, targetUserId))
        .orderBy(desc(rewardLedgerTransactions.createdAt))
        .limit(30),
      db
        .select({
          id: redemptionRequests.id,
          referenceCode: redemptionRequests.referenceCode,
          pointsRequested: redemptionRequests.pointsRequested,
          method: redemptionRequests.method,
          status: redemptionRequests.status,
          payoutReference: redemptionRequests.payoutReference,
          createdAt: redemptionRequests.createdAt,
        })
        .from(redemptionRequests)
        .where(eq(redemptionRequests.userId, targetUserId))
        .orderBy(desc(redemptionRequests.createdAt))
        .limit(20),
      db
        .select()
        .from(learningCompletions)
        .where(eq(learningCompletions.userId, targetUserId)),
    ]);

    return {
      user: {
        ...u,
        communityArea: profile[0]?.communityArea ?? 'FUTO Campus',
        address: profile[0]?.address ?? null,
        nostrPubkey: profile[0]?.nostrPubkey ?? null,
      },
      wallet: wallet[0] ?? null,
      collections: requests,
      ledger,
      redemptions,
      learningCompletions: completions,
    };
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    console.error('Database error in getUserDetailAdmin:', error);
    throw new Error('Unable to load user details.', { cause: error });
  }
}

export async function updateUserAccountAdmin(
  targetUserId: number,
  adminId: number,
  input: {
    role?: unknown;
    isActive?: unknown;
    serviceZone?: unknown;
  }
) {
  const validRoles = new Set<UserRole>(['USER', 'AGENT', 'ADMIN']);

  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (!existing) throw new NotFoundError('User account not found.');

      if (targetUserId === adminId) {
        if (input.isActive === false) {
          throw new ValidationError('Administrators cannot deactivate their own account.');
        }
        if (typeof input.role === 'string' && input.role !== 'ADMIN') {
          throw new ValidationError('Administrators cannot demote their own ADMIN role.');
        }
      }

      const nextRole: UserRole =
        typeof input.role === 'string' && validRoles.has(input.role as UserRole)
          ? (input.role as UserRole)
          : (existing.role as UserRole);
      const nextActive =
        typeof input.isActive === 'boolean' ? input.isActive : existing.isActive;

      const [updated] = await tx
        .update(users)
        .set({ role: nextRole, isActive: nextActive, updatedAt: new Date() })
        .where(eq(users.id, targetUserId))
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          role: users.role,
          isActive: users.isActive,
        });

      if (nextRole === 'AGENT') {
        const zone =
          typeof input.serviceZone === 'string' && input.serviceZone.trim()
            ? input.serviceZone.trim().slice(0, 100)
            : 'FUTO & Ihiagwa';
        await tx
          .insert(collectionAgentProfiles)
          .values({ userId: targetUserId, serviceZone: zone, isAvailable: nextActive })
          .onConflictDoUpdate({
            target: collectionAgentProfiles.userId,
            set: { serviceZone: zone, isAvailable: nextActive, updatedAt: new Date() },
          });
      }

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'USER_ACCOUNT_UPDATED',
        targetType: 'USER',
        targetId: String(targetUserId),
        details: `${existing.email}: role ${existing.role} -> ${nextRole}, active ${existing.isActive} -> ${nextActive}`,
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in updateUserAccountAdmin:', error);
    throw new Error('Could not update user account.', { cause: error });
  }
}

// ============================================================
// STAGE 8: MATERIAL CATEGORY MANAGEMENT
// ============================================================

export async function listAllMaterialsAdmin() {
  try {
    return await db
      .select()
      .from(materialCategories)
      .orderBy(asc(materialCategories.displayOrder), asc(materialCategories.id));
  } catch (error) {
    console.error('Database error in listAllMaterialsAdmin:', error);
    throw new Error('Unable to load material categories.', { cause: error });
  }
}

export async function createMaterialCategoryAdmin(
  adminId: number,
  input: {
    name: unknown;
    description: unknown;
    acceptanceInfo: unknown;
    preparationRequirements: unknown;
    contaminationRules: unknown;
    streamType?: unknown;
    unit?: unknown;
    isActive?: unknown;
  }
) {
  if (typeof input.name !== 'string' || input.name.trim().length < 2) {
    throw new ValidationError('Material name is required.');
  }
  if (typeof input.description !== 'string' || input.description.trim().length < 8) {
    throw new ValidationError('Material description must be at least 8 characters.');
  }
  const name = input.name.trim().slice(0, 80);
  const description = input.description.trim().slice(0, 500);
  const acceptanceInfo =
    typeof input.acceptanceInfo === 'string' && input.acceptanceInfo.trim()
      ? input.acceptanceInfo.trim().slice(0, 400)
      : 'Accepted clean and sorted at approved pilot points.';
  const preparationRequirements =
    typeof input.preparationRequirements === 'string' && input.preparationRequirements.trim()
      ? input.preparationRequirements.trim().slice(0, 400)
      : 'Keep clean, dry, and separate from non-recyclable waste.';
  const contaminationRules =
    typeof input.contaminationRules === 'string' && input.contaminationRules.trim()
      ? input.contaminationRules.trim().slice(0, 400)
      : 'Must be free of liquids, grease, oil, and hazardous substances.';

  const validStreams = new Set<MaterialStreamType>(['RECYCLABLE', 'ORGANIC_W2E', 'RESIDUAL']);
  const streamType: MaterialStreamType =
    typeof input.streamType === 'string' && validStreams.has(input.streamType as MaterialStreamType)
      ? (input.streamType as MaterialStreamType)
      : 'RECYCLABLE';
  const unit =
    typeof input.unit === 'string' && input.unit.trim() ? input.unit.trim().slice(0, 16) : 'kg';
  const isActive =
    typeof input.isActive === 'boolean' ? input.isActive : streamType === 'RECYCLABLE';

  const slug = slugifyName(name);

  try {
    const [created] = await db
      .insert(materialCategories)
      .values({
        name,
        slug,
        description,
        imageUrl: '/src/assets/images/hero_kiln_sorting_1795195681853.jpg',
        unit,
        acceptanceInfo,
        preparationRequirements,
        contaminationRules,
        streamType,
        isActive,
        displayOrder: 10,
      })
      .returning();

    await db.insert(auditLogs).values({
      actorUserId: adminId,
      action: 'MATERIAL_CATEGORY_CREATED',
      targetType: 'MATERIAL_CATEGORY',
      targetId: String(created.id),
      details: `Created material "${created.name}" (${created.streamType}, active=${created.isActive})`,
    });

    return created;
  } catch (error) {
    console.error('Database error in createMaterialCategoryAdmin:', error);
    throw new Error('Could not create material category (check for duplicate name).', {
      cause: error,
    });
  }
}

export async function updateMaterialCategoryAdmin(
  categoryId: number,
  adminId: number,
  input: {
    name?: unknown;
    description?: unknown;
    acceptanceInfo?: unknown;
    preparationRequirements?: unknown;
    contaminationRules?: unknown;
    streamType?: unknown;
    isActive?: unknown;
  }
) {
  const validStreams = new Set<MaterialStreamType>(['RECYCLABLE', 'ORGANIC_W2E', 'RESIDUAL']);
  try {
    const [existing] = await db
      .select()
      .from(materialCategories)
      .where(eq(materialCategories.id, categoryId))
      .limit(1);
    if (!existing) throw new NotFoundError('Material category not found.');

    const updates: Partial<typeof materialCategories.$inferInsert> = { updatedAt: new Date() };
    if (typeof input.name === 'string' && input.name.trim().length >= 2) {
      updates.name = input.name.trim().slice(0, 80);
    }
    if (typeof input.description === 'string' && input.description.trim().length >= 8) {
      updates.description = input.description.trim().slice(0, 500);
    }
    if (typeof input.acceptanceInfo === 'string' && input.acceptanceInfo.trim()) {
      updates.acceptanceInfo = input.acceptanceInfo.trim().slice(0, 400);
    }
    if (typeof input.preparationRequirements === 'string' && input.preparationRequirements.trim()) {
      updates.preparationRequirements = input.preparationRequirements.trim().slice(0, 400);
    }
    if (typeof input.contaminationRules === 'string' && input.contaminationRules.trim()) {
      updates.contaminationRules = input.contaminationRules.trim().slice(0, 400);
    }
    if (
      typeof input.streamType === 'string' &&
      validStreams.has(input.streamType as MaterialStreamType)
    ) {
      updates.streamType = input.streamType;
    }
    if (typeof input.isActive === 'boolean') {
      updates.isActive = input.isActive;
    }

    const [updated] = await db
      .update(materialCategories)
      .set(updates)
      .where(eq(materialCategories.id, categoryId))
      .returning();

    await db.insert(auditLogs).values({
      actorUserId: adminId,
      action: 'MATERIAL_CATEGORY_UPDATED',
      targetType: 'MATERIAL_CATEGORY',
      targetId: String(categoryId),
      details: `Updated "${updated.name}" (stream=${updated.streamType}, active=${updated.isActive})`,
    });

    return updated;
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    console.error('Database error in updateMaterialCategoryAdmin:', error);
    throw new Error('Could not update material category.', { cause: error });
  }
}

// ============================================================
// STAGE 8: OPERATIONAL REPORTS & INJECTION-SAFE CSV EXPORTS
// ============================================================

export interface ReportFilterOptions {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  materialCategoryId?: number;
  method?: string;
}

function parseDateBounds(filters?: ReportFilterOptions) {
  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  if (filters?.dateFrom) {
    const d = new Date(filters.dateFrom);
    if (!Number.isNaN(d.getTime())) fromDate = d;
  }
  if (filters?.dateTo) {
    const d = new Date(filters.dateTo);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCHours(23, 59, 59, 999);
      toDate = d;
    }
  }
  return { fromDate, toDate };
}

export async function getOperationalReportsAdmin(filters?: ReportFilterOptions) {
  const { fromDate, toDate } = parseDateBounds(filters);

  try {
    const reqConds = [];
    if (fromDate) reqConds.push(gte(collectionRequests.createdAt, fromDate));
    if (toDate) reqConds.push(lte(collectionRequests.createdAt, toDate));
    if (filters?.status && filters.status !== 'ALL') {
      reqConds.push(eq(collectionRequests.status, filters.status));
    }
    if (filters?.materialCategoryId) {
      reqConds.push(eq(collectionRequests.materialCategoryId, filters.materialCategoryId));
    }

    const [
      requests,
      verifications,
      submissions,
      ledger,
      redemptions,
      entries,
      batches,
      transfers,
      sales,
      completions,
      cats,
      userList,
    ] = await Promise.all([
      reqConds.length
        ? db.select().from(collectionRequests).where(and(...reqConds))
        : db.select().from(collectionRequests),
      db.select().from(weightVerifications),
      db.select().from(wasteSubmissions),
      db.select().from(rewardLedgerTransactions),
      db.select().from(redemptionRequests),
      db.select().from(inventoryEntries),
      db.select().from(materialBatches),
      db.select().from(materialTransfers),
      db.select().from(materialSales),
      db.select().from(learningCompletions),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
      db.select({ id: users.id, fullName: users.fullName, role: users.role }).from(users),
    ]);

    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const userMap = new Map(userList.map((u) => [u.id, u.fullName]));
    const reqSet = new Set(requests.map((r) => r.id));

    const filteredVerifications = verifications.filter((v) => reqSet.has(v.collectionRequestId));
    const filteredSubmissions = submissions.filter((s) => reqSet.has(s.collectionRequestId));

    // Material breakdown
    const matAgg = new Map<number, { name: string; requests: number; verifiedKgCg: number; pointsCents: bigint }>();
    for (const c of cats) {
      matAgg.set(c.id, { name: c.name, requests: 0, verifiedKgCg: 0, pointsCents: 0n });
    }
    for (const r of requests) {
      const b = matAgg.get(r.materialCategoryId);
      if (b) b.requests += 1;
    }
    const reqById = new Map(requests.map((r) => [r.id, r]));
    for (const v of filteredVerifications) {
      if (v.decision === 'APPROVED') {
        const req = reqById.get(v.collectionRequestId);
        if (req) {
          const b = matAgg.get(req.materialCategoryId);
          if (b) {
            b.verifiedKgCg += parseCentigrams(v.verifiedEligibleWeightKg) ?? 0;
            b.pointsCents += parsePointsToCents(v.pointsAwarded) ?? 0n;
          }
        }
      }
    }

    // Agent activity
    const agentAgg = new Map<number, { agentName: string; submissionsCount: number; eligibleKgCg: number }>();
    for (const s of filteredSubmissions) {
      const curr = agentAgg.get(s.recordedByAgentId) ?? {
        agentName: userMap.get(s.recordedByAgentId) ?? 'Agent',
        submissionsCount: 0,
        eligibleKgCg: 0,
      };
      curr.submissionsCount += 1;
      curr.eligibleKgCg += parseCentigrams(s.eligibleWeightKg) ?? 0;
      agentAgg.set(s.recordedByAgentId, curr);
    }

    // Filter ledger & redemptions by date range
    const inRange = (d: Date) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    const filteredLedger = ledger.filter((t) => inRange(t.createdAt));
    const filteredRedemptions = redemptions.filter(
      (r) =>
        inRange(r.createdAt) &&
        (!filters?.method || filters.method === 'ALL' || r.method === filters.method)
    );
    const filteredSales = sales.filter((s) => inRange(s.saleDate));
    const filteredTransfers = transfers.filter((t) => inRange(t.transferDate));

    let collectionRewardPts = 0n;
    let learningBonusPts = 0n;
    let adjustmentNetPts = 0n;
    for (const t of filteredLedger) {
      const cents = parsePointsToCents(t.amountPoints) ?? 0n;
      if (t.transactionType === 'COLLECTION_REWARD') collectionRewardPts += cents;
      if (t.transactionType === 'LEARNING_BONUS') learningBonusPts += cents;
      if (t.transactionType === 'ADMIN_ADJUSTMENT') {
        adjustmentNetPts += t.direction === 'CREDIT' ? cents : -cents;
      }
    }

    const totalVerifiedKgCg = filteredVerifications
      .filter((v) => v.decision === 'APPROVED')
      .reduce((sum, v) => sum + (parseCentigrams(v.verifiedEligibleWeightKg) ?? 0), 0);

    const paidRedemptionsList = filteredRedemptions.filter((r) => r.status === 'PAID');
    const totalRedeemedPointsCents = paidRedemptionsList.reduce(
      (sum, r) => sum + (parsePointsToCents(r.pointsRequested) ?? 0n),
      0n
    );

    const unbatchedKgCg = entries.reduce(
      (sum, e) => sum + (parseCentigrams(e.availableWeightKg) ?? 0),
      0
    );
    const batchedAvailableKgCg = batches.reduce(
      (sum, b) => sum + (parseCentigrams(b.availableWeightKg) ?? 0),
      0
    );

    const paidSalesNgnFormatted = formatCentsToPoints(
      filteredSales
        .filter((s) => s.paymentStatus === 'PAID')
        .reduce((sum, s) => sum + (parsePointsToCents(s.totalValueNgn) ?? 0n), 0n)
    );

    const passedLearningCount = completions.filter((c) => c.passed).length;

    return {
      collections: {
        totalRequests: requests.length,
        verifiedCount: filteredVerifications.filter((v) => v.decision === 'APPROVED').length,
        verifiedWeightKg: formatCentigramsToKg(totalVerifiedKgCg),
        rejectedCount: requests.filter((r) => r.status === 'REJECTED').length,
        cancelledCount: requests.filter((r) => r.status === 'CANCELLED').length,
      },
      materialsBreakdown: Array.from(matAgg.entries()).map(([id, m]) => ({
        materialCategoryId: id,
        materialName: m.name,
        requestsCount: m.requests,
        verifiedEligibleKg: formatCentigramsToKg(m.verifiedKgCg),
        pointsAwarded: formatCentsToPoints(m.pointsCents),
      })),
      agentActivity: Array.from(agentAgg.entries()).map(([agentId, a]) => ({
        agentId,
        agentName: a.agentName,
        submissionsCount: a.submissionsCount,
        eligibleWeightKg: formatCentigramsToKg(a.eligibleKgCg),
      })),
      rewards: {
        totalCreditedPoints: formatCentsToPoints(collectionRewardPts + learningBonusPts),
        totalRedeemedPoints: formatCentsToPoints(totalRedeemedPointsCents),
        paidRedemptions: paidRedemptionsList.length,
        collectionRewardPoints: formatCentsToPoints(collectionRewardPts),
        learningBonusPoints: formatCentsToPoints(learningBonusPts),
        adminAdjustmentNetPoints: formatCentsToPoints(adjustmentNetPts),
        ledgerEntriesCount: filteredLedger.length,
      },
      redemptions: {
        totalRequests: filteredRedemptions.length,
        paidCount: paidRedemptionsList.length,
        pendingCount: filteredRedemptions.filter((r) =>
          ['PENDING', 'APPROVED', 'PROCESSING'].includes(r.status)
        ).length,
        rejectedOrFailedCount: filteredRedemptions.filter((r) =>
          ['REJECTED', 'FAILED'].includes(r.status)
        ).length,
      },
      inventory: {
        unbatchedKg: formatCentigramsToKg(unbatchedKgCg),
        batchedAvailableKg: formatCentigramsToKg(batchedAvailableKgCg),
        batchesCount: batches.length,
        transfersCount: filteredTransfers.length,
        salesCount: filteredSales.length,
        soldKg: formatCentigramsToKg(
          filteredSales
            .filter((s) => s.transferStatus !== 'CANCELLED')
            .reduce((sum, s) => sum + (parseCentigrams(s.quantityKg) ?? 0), 0)
        ),
        paidSalesNgn: paidSalesNgnFormatted,
        salesRevenueNgn: paidSalesNgnFormatted,
      },
      learning: {
        totalCompletions: completions.length,
        passedCount: passedLearningCount,
        passedCompletions: passedLearningCount,
      },
      materialLookup: Object.fromEntries(catMap),
    };
  } catch (error) {
    console.error('Database error in getOperationalReportsAdmin:', error);
    throw new Error('Unable to generate operational report.', { cause: error });
  }
}

export type CsvReportType =
  | 'collections'
  | 'verifications'
  | 'rewards'
  | 'redemptions'
  | 'inventory'
  | 'sales'
  | 'audit';

export async function generateAdminCsvExport(
  reportType: CsvReportType,
  filters: ReportFilterOptions,
  adminId: number
): Promise<{ filename: string; csv: string }> {
  const { fromDate, toDate } = parseDateBounds(filters);
  const inRange = (d: Date) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
  const dateStamp = new Date().toISOString().slice(0, 10);

  let csv = '';

  if (reportType === 'collections') {
    const [reqs, cats, vers] = await Promise.all([
      db.select().from(collectionRequests).orderBy(desc(collectionRequests.createdAt)),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
      db.select().from(weightVerifications),
    ]);
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const verMap = new Map(vers.map((v) => [v.collectionRequestId, v]));

    const filtered = reqs.filter(
      (r) =>
        inRange(r.createdAt) &&
        (!filters.status || filters.status === 'ALL' || r.status === filters.status) &&
        (!filters.materialCategoryId || r.materialCategoryId === filters.materialCategoryId)
    );

    csv = buildCsvDocument(
      [
        'Reference Code',
        'Material',
        'Method',
        'Community Area',
        'Estimated Weight (kg)',
        'Status',
        'Verified Eligible (kg)',
        'Applied Rate (pts/kg)',
        'Points Awarded',
        'Demo Record',
        'Created UTC',
      ],
      filtered.map((r) => {
        const v = verMap.get(r.id);
        return [
          r.referenceCode,
          catMap.get(r.materialCategoryId) ?? r.materialCategoryId,
          r.collectionMethod,
          r.communityArea,
          r.estimatedWeightKg,
          r.status,
          v?.verifiedEligibleWeightKg ?? '',
          v?.appliedPointsPerKg ?? '',
          v?.pointsAwarded ?? '',
          r.isDemo ? 'YES' : 'NO',
          r.createdAt.toISOString(),
        ];
      })
    );
  } else if (reportType === 'verifications') {
    const [vers, subs, reqs, cats] = await Promise.all([
      db.select().from(weightVerifications).orderBy(desc(weightVerifications.verifiedAt)),
      db.select().from(wasteSubmissions),
      db.select().from(collectionRequests),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
    ]);
    const subMap = new Map(subs.map((s) => [s.id, s]));
    const reqMap = new Map(reqs.map((r) => [r.id, r]));
    const catMap = new Map(cats.map((c) => [c.id, c.name]));

    const filtered = vers.filter((v) => {
      if (!inRange(v.verifiedAt)) return false;
      const req = reqMap.get(v.collectionRequestId);
      if (filters.materialCategoryId && req?.materialCategoryId !== filters.materialCategoryId) {
        return false;
      }
      return true;
    });

    csv = buildCsvDocument(
      [
        'Verification ID',
        'Collection Reference',
        'Material',
        'Decision',
        'Actual Weight (kg)',
        'Rejected Weight (kg)',
        'Verified Eligible (kg)',
        'Quality Grade',
        'Applied Rate (pts/kg)',
        'Points Awarded',
        'Demo Rate',
        'Verified By Admin ID',
        'Review Notes',
        'Verified UTC',
      ],
      filtered.map((v) => {
        const sub = subMap.get(v.submissionId);
        const req = reqMap.get(v.collectionRequestId);
        return [
          v.id,
          req?.referenceCode ?? v.collectionRequestId,
          req ? (catMap.get(req.materialCategoryId) ?? req.materialCategoryId) : '',
          v.decision,
          sub?.actualWeightKg ?? '',
          sub?.rejectedWeightKg ?? '',
          v.verifiedEligibleWeightKg,
          sub?.qualityGrade ?? '',
          v.appliedPointsPerKg ?? '',
          v.pointsAwarded,
          v.appliedRateIsDemo ? 'YES' : 'NO',
          v.verifiedByAdminId,
          v.reviewNotes ?? '',
          v.verifiedAt.toISOString(),
        ];
      })
    );
  } else if (reportType === 'rewards') {
    const rows = (
      await db
        .select()
        .from(rewardLedgerTransactions)
        .orderBy(desc(rewardLedgerTransactions.createdAt))
    ).filter((r) => inRange(r.createdAt));

    csv = buildCsvDocument(
      [
        'Ledger Ref',
        'User ID',
        'Type',
        'Direction',
        'Amount (pts)',
        'Signed (pts)',
        'Balance After (pts)',
        'Applied Rate (pts/kg)',
        'Description',
        'Demo',
        'Created UTC',
      ],
      rows.map((r) => [
        r.referenceCode,
        r.userId,
        r.transactionType,
        r.direction,
        r.amountPoints,
        r.signedPoints,
        r.balanceAfter,
        r.appliedRatePerKg ?? '',
        r.description,
        r.isDemo ? 'YES' : 'NO',
        r.createdAt.toISOString(),
      ])
    );
  } else if (reportType === 'redemptions') {
    const rows = (
      await db.select().from(redemptionRequests).orderBy(desc(redemptionRequests.createdAt))
    ).filter(
      (r) =>
        inRange(r.createdAt) &&
        (!filters.status || filters.status === 'ALL' || r.status === filters.status) &&
        (!filters.method || filters.method === 'ALL' || r.method === filters.method)
    );

    // Note: Exports masked destinationSummary only, never raw bank account numbers or secrets!
    csv = buildCsvDocument(
      [
        'Redemption Ref',
        'User ID',
        'Points Requested',
        'Method',
        'Destination (Masked)',
        'Est Value',
        'Unit',
        'Status',
        'Payout Reference',
        'Demo',
        'Created UTC',
      ],
      rows.map((r) => [
        r.referenceCode,
        r.userId,
        r.pointsRequested,
        r.method,
        r.destinationSummary,
        r.estimatedValueAmount,
        r.estimatedValueUnit,
        r.status,
        r.payoutReference ?? '',
        r.isDemo ? 'YES' : 'NO',
        r.createdAt.toISOString(),
      ])
    );
  } else if (reportType === 'inventory') {
    const [batches, cats] = await Promise.all([
      db.select().from(materialBatches).orderBy(desc(materialBatches.createdAt)),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
    ]);
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const filtered = batches.filter(
      (b) =>
        inRange(b.createdAt) &&
        (!filters.materialCategoryId || b.materialCategoryId === filters.materialCategoryId)
    );

    csv = buildCsvDocument(
      [
        'Batch Ref',
        'Material',
        'Total Weight (kg)',
        'Available Weight (kg)',
        'Reserved Weight (kg)',
        'Status',
        'Demo',
        'Notes',
        'Created UTC',
      ],
      filtered.map((b) => [
        b.batchReference,
        catMap.get(b.materialCategoryId) ?? b.materialCategoryId,
        b.totalWeightKg,
        b.availableWeightKg,
        b.reservedWeightKg,
        b.status,
        b.isDemo ? 'YES' : 'NO',
        b.notes ?? '',
        b.createdAt.toISOString(),
      ])
    );
  } else if (reportType === 'sales') {
    const [sales, cats] = await Promise.all([
      db.select().from(materialSales).orderBy(desc(materialSales.saleDate)),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
    ]);
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const filtered = sales.filter((s) => inRange(s.saleDate));

    csv = buildCsvDocument(
      [
        'Sale Ref',
        'Material',
        'Buyer Name',
        'Quantity (kg)',
        'Unit Price (NGN)',
        'Total Value (NGN)',
        'Transfer Status',
        'Payment Status',
        'Doc Ref',
        'Sale Date UTC',
      ],
      filtered.map((s) => [
        s.referenceCode,
        catMap.get(s.materialCategoryId) ?? s.materialCategoryId,
        s.buyerName,
        s.quantityKg,
        s.unitPriceNgn ?? '',
        s.totalValueNgn,
        s.transferStatus,
        s.paymentStatus,
        s.documentationRef ?? '',
        s.saleDate.toISOString(),
      ])
    );
  } else {
    const logs = (
      await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(500)
    ).filter((l) => inRange(l.createdAt));

    csv = buildCsvDocument(
      ['Log ID', 'Actor User ID', 'Action', 'Target Type', 'Target ID', 'Details', 'Created UTC'],
      logs.map((l) => [
        l.id,
        l.actorUserId ?? '',
        l.action,
        l.targetType,
        l.targetId ?? '',
        l.details ?? '',
        l.createdAt.toISOString(),
      ])
    );
  }

  await db.insert(auditLogs).values({
    actorUserId: adminId,
    action: 'ADMIN_CSV_EXPORTED',
    targetType: 'REPORT',
    targetId: reportType,
    details: `Exported ${reportType} CSV report`,
  });

  return {
    filename: `kiln-${reportType}-report-${dateStamp}.csv`,
    csv,
  };
}

// ============================================================
// STAGE 8: AUDIT LOGS VIEWER (READ-ONLY)
// ============================================================

export async function listAuditLogsAdmin(filters?: { action?: string; search?: string; limit?: number }) {
  try {
    const limit = Math.min(250, Math.max(10, filters?.limit ?? 120));
    const [logs, userList] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit),
      db.select({ id: users.id, fullName: users.fullName, email: users.email, role: users.role }).from(users),
    ]);

    const userMap = new Map(userList.map((u) => [u.id, u]));
    let hydrated = logs.map((l) => {
      const actor = l.actorUserId ? userMap.get(l.actorUserId) : null;
      return {
        ...l,
        actorName: actor?.fullName ?? 'System',
        actorEmail: actor?.email ?? '',
        actorRole: actor?.role ?? 'SYSTEM',
      };
    });

    if (filters?.action && filters.action !== 'ALL') {
      hydrated = hydrated.filter((l) => l.action === filters.action);
    }
    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      hydrated = hydrated.filter(
        (l) =>
          l.action.toLowerCase().includes(q) ||
          (l.details ?? '').toLowerCase().includes(q) ||
          l.actorName.toLowerCase().includes(q) ||
          l.targetType.toLowerCase().includes(q)
      );
    }

    return hydrated;
  } catch (error) {
    console.error('Database error in listAuditLogsAdmin:', error);
    throw new Error('Unable to load audit logs.', { cause: error });
  }
}
