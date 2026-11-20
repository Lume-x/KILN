import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  collectionAgentProfiles,
  collectionAssignments,
  collectionPoints,
  collectionRequests,
  materialCategories,
  users,
  wasteSubmissions,
  weightVerifications,
  type CollectionMethod,
  type CollectionPointStatus,
  type CollectionRequestStatus,
  type QualityGrade,
  type VerificationDecision,
} from './schema.ts';
import {
  VALID_QUALITY_GRADES,
  canTransitionCollectionStatus,
  formatCentigramsToKg,
  generateCollectionReference,
  parseCentigrams,
  slugifyName,
  validateUploadedPhoto,
  validateWeightTriplet,
} from '../lib/collection-rules.ts';
import type { SafeUserContext } from './repositories.ts';
import { calculateRewardPointsCents } from '../lib/rewards-rules.ts';
import { creditWalletLedgerTx, getActiveRewardRateTx } from './rewards-repository.ts';
import { receiveVerifiedMaterialToInventoryTx } from './inventory-repository.ts';
import { createNotificationTx, notifyActiveAdminsTx } from './notifications-repository.ts';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface HydratedCollectionRequest {
  id: number;
  referenceCode: string;
  userId: number;
  userName: string;
  userEmail: string;
  userPhone: string | null;
  materialCategoryId: number;
  materialName: string;
  materialUnit: string;
  estimatedWeightKg: string;
  collectionMethod: CollectionMethod;
  collectionPointId: number | null;
  collectionPointName: string | null;
  collectionPointAddress: string | null;
  collectionPointHours: string | null;
  collectionPointStatus: string | null;
  pickupAddress: string | null;
  communityArea: string;
  landmarksDirections: string | null;
  preferredWindow: string;
  notes: string | null;
  photoDataUrl: string | null;
  status: CollectionRequestStatus;
  statusReason: string | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
  activeAssignment: {
    id: number;
    agentUserId: number;
    agentName: string;
    agentEmail: string;
    status: string;
    agentResponseNote: string | null;
    assignedAt: Date;
    respondedAt: Date | null;
    startedAt: Date | null;
    collectedAt: Date | null;
  } | null;
  submission: {
    id: number;
    materialCategoryId: number;
    materialName: string;
    actualWeightKg: string;
    rejectedWeightKg: string;
    eligibleWeightKg: string;
    qualityGrade: string;
    contaminationNotes: string | null;
    agentNotes: string | null;
    evidencePhotoUrl: string | null;
    recordedByAgentId: number;
    recordedByAgentName: string;
    collectedAt: Date;
    createdAt: Date;
  } | null;
  verification: {
    id: number;
    decision: VerificationDecision;
    verifiedEligibleWeightKg: string;
    appliedRewardRateId: number | null;
    appliedPointsPerKg: string | null;
    appliedRateIsDemo: boolean;
    pointsAwarded: string;
    reviewNotes: string | null;
    verifiedByAdminId: number;
    verifiedByAdminName: string;
    verifiedAt: Date;
  } | null;
}

async function hydrateCollectionRequests(
  requestRows: Array<typeof collectionRequests.$inferSelect>
): Promise<HydratedCollectionRequest[]> {
  if (!requestRows.length) {
    return [];
  }

  const requestIds = requestRows.map((r) => r.id);
  const categoryIds = new Set<number>(requestRows.map((r) => r.materialCategoryId));
  const pointIds = new Set<number>(
    requestRows.map((r) => r.collectionPointId).filter((id): id is number => id !== null)
  );
  const userIds = new Set<number>(requestRows.map((r) => r.userId));

  const [assignmentRows, submissionRows, verificationRows] = await Promise.all([
    db
      .select()
      .from(collectionAssignments)
      .where(inArray(collectionAssignments.collectionRequestId, requestIds))
      .orderBy(desc(collectionAssignments.assignedAt), desc(collectionAssignments.id)),
    db
      .select()
      .from(wasteSubmissions)
      .where(inArray(wasteSubmissions.collectionRequestId, requestIds)),
    db
      .select()
      .from(weightVerifications)
      .where(inArray(weightVerifications.collectionRequestId, requestIds)),
  ]);

  for (const a of assignmentRows) {
    userIds.add(a.agentUserId);
  }
  for (const s of submissionRows) {
    userIds.add(s.recordedByAgentId);
    categoryIds.add(s.materialCategoryId);
  }
  for (const v of verificationRows) {
    userIds.add(v.verifiedByAdminId);
  }

  const [userList, categoryList, pointList] = await Promise.all([
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        phoneNumber: users.phoneNumber,
      })
      .from(users)
      .where(inArray(users.id, Array.from(userIds))),
    db
      .select({
        id: materialCategories.id,
        name: materialCategories.name,
        unit: materialCategories.unit,
      })
      .from(materialCategories)
      .where(inArray(materialCategories.id, Array.from(categoryIds))),
    pointIds.size > 0
      ? db
          .select({
            id: collectionPoints.id,
            name: collectionPoints.name,
            address: collectionPoints.address,
            operatingHours: collectionPoints.operatingHours,
            status: collectionPoints.status,
          })
          .from(collectionPoints)
          .where(inArray(collectionPoints.id, Array.from(pointIds)))
      : Promise.resolve([]),
  ]);

  const userMap = new Map(userList.map((u) => [u.id, u]));
  const categoryMap = new Map(categoryList.map((c) => [c.id, c]));
  const pointMap = new Map(pointList.map((p) => [p.id, p]));

  const latestAssignmentMap = new Map<number, typeof collectionAssignments.$inferSelect>();
  for (const a of assignmentRows) {
    if (!latestAssignmentMap.has(a.collectionRequestId)) {
      latestAssignmentMap.set(a.collectionRequestId, a);
    }
  }

  const submissionMap = new Map(submissionRows.map((s) => [s.collectionRequestId, s]));
  const verificationMap = new Map(verificationRows.map((v) => [v.collectionRequestId, v]));

  return requestRows.map((req) => {
    const owner = userMap.get(req.userId);
    const mat = categoryMap.get(req.materialCategoryId);
    const pt = req.collectionPointId ? pointMap.get(req.collectionPointId) : null;
    const assign = latestAssignmentMap.get(req.id) ?? null;
    const sub = submissionMap.get(req.id) ?? null;
    const ver = verificationMap.get(req.id) ?? null;

    const assignAgent = assign ? userMap.get(assign.agentUserId) : null;
    const subAgent = sub ? userMap.get(sub.recordedByAgentId) : null;
    const subMat = sub ? categoryMap.get(sub.materialCategoryId) : null;
    const verAdmin = ver ? userMap.get(ver.verifiedByAdminId) : null;

    return {
      id: req.id,
      referenceCode: req.referenceCode,
      userId: req.userId,
      userName: owner?.fullName ?? 'Unknown Participant',
      userEmail: owner?.email ?? '',
      userPhone: owner?.phoneNumber ?? null,
      materialCategoryId: req.materialCategoryId,
      materialName: mat?.name ?? 'Unknown Material',
      materialUnit: mat?.unit ?? 'kg',
      estimatedWeightKg: req.estimatedWeightKg,
      collectionMethod: req.collectionMethod as CollectionMethod,
      collectionPointId: req.collectionPointId,
      collectionPointName: pt?.name ?? null,
      collectionPointAddress: pt?.address ?? null,
      collectionPointHours: pt?.operatingHours ?? null,
      collectionPointStatus: pt?.status ?? null,
      pickupAddress: req.pickupAddress,
      communityArea: req.communityArea,
      landmarksDirections: req.landmarksDirections,
      preferredWindow: req.preferredWindow,
      notes: req.notes,
      photoDataUrl: req.photoDataUrl,
      status: req.status as CollectionRequestStatus,
      statusReason: req.statusReason,
      isDemo: req.isDemo,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
      activeAssignment: assign
        ? {
            id: assign.id,
            agentUserId: assign.agentUserId,
            agentName: assignAgent?.fullName ?? 'Assigned Agent',
            agentEmail: assignAgent?.email ?? '',
            status: assign.status,
            agentResponseNote: assign.agentResponseNote,
            assignedAt: assign.assignedAt,
            respondedAt: assign.respondedAt,
            startedAt: assign.startedAt,
            collectedAt: assign.collectedAt,
          }
        : null,
      submission: sub
        ? {
            id: sub.id,
            materialCategoryId: sub.materialCategoryId,
            materialName: subMat?.name ?? mat?.name ?? 'Material',
            actualWeightKg: sub.actualWeightKg,
            rejectedWeightKg: sub.rejectedWeightKg,
            eligibleWeightKg: sub.eligibleWeightKg,
            qualityGrade: sub.qualityGrade,
            contaminationNotes: sub.contaminationNotes,
            agentNotes: sub.agentNotes,
            evidencePhotoUrl: sub.evidencePhotoUrl,
            recordedByAgentId: sub.recordedByAgentId,
            recordedByAgentName: subAgent?.fullName ?? 'Collection Agent',
            collectedAt: sub.collectedAt,
            createdAt: sub.createdAt,
          }
        : null,
      verification: ver
        ? {
            id: ver.id,
            decision: ver.decision as VerificationDecision,
            verifiedEligibleWeightKg: ver.verifiedEligibleWeightKg,
            appliedRewardRateId: ver.appliedRewardRateId ?? null,
            appliedPointsPerKg: ver.appliedPointsPerKg ?? null,
            appliedRateIsDemo: ver.appliedRateIsDemo ?? false,
            pointsAwarded: ver.pointsAwarded ?? '0.00',
            reviewNotes: ver.reviewNotes,
            verifiedByAdminId: ver.verifiedByAdminId,
            verifiedByAdminName: verAdmin?.fullName ?? 'Administrator',
            verifiedAt: ver.verifiedAt,
          }
        : null,
    };
  });
}

// ============================================================
// USER COLLECTION REQUESTS
// ============================================================

export async function createCollectionRequest(
  user: SafeUserContext,
  input: {
    materialCategoryId: unknown;
    estimatedWeightKg: unknown;
    collectionMethod: unknown;
    collectionPointId?: unknown;
    pickupAddress?: unknown;
    communityArea?: unknown;
    landmarksDirections?: unknown;
    preferredWindow: unknown;
    notes?: unknown;
    photoDataUrl?: unknown;
  }
): Promise<HydratedCollectionRequest> {
  const materialId = Number(input.materialCategoryId);
  if (!Number.isInteger(materialId) || materialId <= 0) {
    throw new ValidationError('Please select a valid recyclable material category.');
  }

  const estimatedCg = parseCentigrams(input.estimatedWeightKg);
  if (estimatedCg === null || estimatedCg <= 0) {
    throw new ValidationError('Estimated weight must be greater than 0 kg (up to 2 decimal places).');
  }
  if (estimatedCg > 500000) {
    throw new ValidationError('Estimated weight cannot exceed 5,000.00 kg per request.');
  }

  if (input.collectionMethod !== 'PICKUP' && input.collectionMethod !== 'DROP_OFF') {
    throw new ValidationError('Collection method must be either Pickup or Drop-off.');
  }
  const method = input.collectionMethod as CollectionMethod;

  if (typeof input.preferredWindow !== 'string' || input.preferredWindow.trim().length < 3) {
    throw new ValidationError('Please provide a preferred collection or drop-off time window.');
  }
  const preferredWindow = input.preferredWindow.trim().slice(0, 120);

  const photoValidation = validateUploadedPhoto(input.photoDataUrl);
  if (!photoValidation.ok) {
    throw new ValidationError(photoValidation.error);
  }

  const notes =
    typeof input.notes === 'string' && input.notes.trim().length > 0
      ? input.notes.trim().slice(0, 1000)
      : null;

  try {
    const [material] = await db
      .select()
      .from(materialCategories)
      .where(
        and(
          eq(materialCategories.id, materialId),
          eq(materialCategories.streamType, 'RECYCLABLE'),
          eq(materialCategories.isActive, true)
        )
      )
      .limit(1);

    if (!material) {
      throw new ValidationError('Selected material category is not currently accepted.');
    }

    let resolvedPointId: number | null = null;
    let resolvedCommunityArea =
      typeof input.communityArea === 'string' && input.communityArea.trim().length > 0
        ? input.communityArea.trim()
        : user.communityArea || 'FUTO Campus';
    let resolvedPickupAddress: string | null = null;
    let resolvedLandmarks: string | null = null;

    if (method === 'PICKUP') {
      if (typeof input.pickupAddress !== 'string' || input.pickupAddress.trim().length < 5) {
        throw new ValidationError(
          'Please enter a pickup address (hostel, lodge, street, or shop location).'
        );
      }
      resolvedPickupAddress = input.pickupAddress.trim().slice(0, 300);
      resolvedLandmarks =
        typeof input.landmarksDirections === 'string' && input.landmarksDirections.trim().length > 0
          ? input.landmarksDirections.trim().slice(0, 300)
          : null;
    } else {
      const pointId = Number(input.collectionPointId);
      if (!Number.isInteger(pointId) || pointId <= 0) {
        throw new ValidationError('Please select an approved drop-off collection point.');
      }
      const [point] = await db
        .select()
        .from(collectionPoints)
        .where(
          and(
            eq(collectionPoints.id, pointId),
            or(eq(collectionPoints.status, 'ACTIVE'), eq(collectionPoints.status, 'DEMO'))
          )
        )
        .limit(1);

      if (!point) {
        throw new ValidationError(
          'Selected collection point is not currently accepting drop-off submissions.'
        );
      }
      resolvedPointId = point.id;
      resolvedCommunityArea = point.communityArea;
    }

    const referenceCode = generateCollectionReference();

    const createdRow = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(collectionRequests)
        .values({
          referenceCode,
          userId: user.id,
          materialCategoryId: material.id,
          estimatedWeightKg: formatCentigramsToKg(estimatedCg),
          collectionMethod: method,
          collectionPointId: resolvedPointId,
          pickupAddress: resolvedPickupAddress,
          communityArea: resolvedCommunityArea,
          landmarksDirections: resolvedLandmarks,
          preferredWindow,
          notes,
          photoDataUrl: photoValidation.value,
          status: 'PENDING',
          isDemo: user.isDemo,
        })
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: user.id,
        action: 'COLLECTION_REQUEST_CREATED',
        targetType: 'COLLECTION_REQUEST',
        targetId: String(inserted.id),
        details: `${referenceCode} · ${material.name} · est ${formatCentigramsToKg(estimatedCg)} kg · ${method}`,
      });

      await createNotificationTx(tx, {
        userId: user.id,
        eventType: 'COLLECTION_SUBMITTED',
        title: `Collection Request Submitted (${referenceCode})`,
        message: `Your ${material.name} request (${formatCentigramsToKg(estimatedCg)} kg estimated) is pending coordinator review.`,
        actionRoute: '/collections',
        relatedType: 'COLLECTION_REQUEST',
        relatedId: String(inserted.id),
      });

      await notifyActiveAdminsTx(tx, {
        eventType: 'COLLECTION_SUBMITTED',
        title: `New Collection Request (${referenceCode})`,
        message: `${user.fullName} submitted ${material.name} (${formatCentigramsToKg(estimatedCg)} kg est., ${method}).`,
        actionRoute: '/admin',
        relatedType: 'COLLECTION_REQUEST',
        relatedId: String(inserted.id),
      });

      return inserted;
    });

    const [hydrated] = await hydrateCollectionRequests([createdRow]);
    return hydrated;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    console.error('Database error in createCollectionRequest:', error);
    throw new Error('Could not create collection request right now. Please try again.', {
      cause: error,
    });
  }
}

export async function listUserCollectionRequests(
  userId: number,
  statusFilter?: string
): Promise<HydratedCollectionRequest[]> {
  try {
    const conditions = [eq(collectionRequests.userId, userId)];
    if (statusFilter && statusFilter !== 'ALL') {
      conditions.push(eq(collectionRequests.status, statusFilter));
    }

    const rows = await db
      .select()
      .from(collectionRequests)
      .where(and(...conditions))
      .orderBy(desc(collectionRequests.createdAt), desc(collectionRequests.id));

    return await hydrateCollectionRequests(rows);
  } catch (error) {
    console.error('Database error in listUserCollectionRequests:', error);
    throw new Error('Unable to load your collection requests right now.', { cause: error });
  }
}

export async function getCollectionRequestForViewer(
  requestId: number,
  viewer: SafeUserContext
): Promise<HydratedCollectionRequest> {
  try {
    const [row] = await db
      .select()
      .from(collectionRequests)
      .where(eq(collectionRequests.id, requestId))
      .limit(1);

    if (!row) {
      throw new NotFoundError('Collection request not found.');
    }

    if (viewer.role === 'USER' && row.userId !== viewer.id) {
      throw new ForbiddenError('You do not have permission to view this collection request.');
    }

    if (viewer.role === 'AGENT' && row.userId !== viewer.id) {
      const [assigned] = await db
        .select({ id: collectionAssignments.id })
        .from(collectionAssignments)
        .where(
          and(
            eq(collectionAssignments.collectionRequestId, row.id),
            eq(collectionAssignments.agentUserId, viewer.id)
          )
        )
        .limit(1);

      if (!assigned) {
        throw new ForbiddenError('You can only view collection requests assigned to you.');
      }
    }

    const [hydrated] = await hydrateCollectionRequests([row]);
    return hydrated;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      throw error;
    }
    console.error('Database error in getCollectionRequestForViewer:', error);
    throw new Error('Unable to load collection request details.', { cause: error });
  }
}

export async function cancelUserCollectionRequest(
  requestId: number,
  userId: number,
  reason?: string
): Promise<HydratedCollectionRequest> {
  try {
    const updatedRow = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(collectionRequests)
        .where(eq(collectionRequests.id, requestId))
        .limit(1);

      if (!existing) {
        throw new NotFoundError('Collection request not found.');
      }
      if (existing.userId !== userId) {
        throw new ForbiddenError('You can only cancel your own collection requests.');
      }

      const currentStatus = existing.status as CollectionRequestStatus;
      if (currentStatus !== 'PENDING' && currentStatus !== 'APPROVED') {
        throw new ValidationError(
          `Requests in status ${currentStatus} cannot be cancelled by the participant.`
        );
      }

      const [updated] = await tx
        .update(collectionRequests)
        .set({
          status: 'CANCELLED',
          statusReason: reason?.trim() || 'Cancelled by participant',
          updatedAt: new Date(),
        })
        .where(eq(collectionRequests.id, requestId))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: userId,
        action: 'COLLECTION_REQUEST_CANCELLED',
        targetType: 'COLLECTION_REQUEST',
        targetId: String(requestId),
        details: `${existing.referenceCode} cancelled by participant`,
      });

      return updated;
    });

    const [hydrated] = await hydrateCollectionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    console.error('Database error in cancelUserCollectionRequest:', error);
    throw new Error('Could not cancel collection request.', { cause: error });
  }
}

// ============================================================
// ADMIN COLLECTION & VERIFICATION MANAGEMENT
// ============================================================

export async function listAllCollectionRequestsAdmin(filters?: {
  status?: string;
  materialCategoryId?: number;
  method?: string;
}): Promise<HydratedCollectionRequest[]> {
  try {
    const conditions = [];
    if (filters?.status && filters.status !== 'ALL') {
      conditions.push(eq(collectionRequests.status, filters.status));
    }
    if (filters?.materialCategoryId && Number.isInteger(filters.materialCategoryId)) {
      conditions.push(eq(collectionRequests.materialCategoryId, filters.materialCategoryId));
    }
    if (filters?.method === 'PICKUP' || filters?.method === 'DROP_OFF') {
      conditions.push(eq(collectionRequests.collectionMethod, filters.method));
    }

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(collectionRequests)
            .where(and(...conditions))
            .orderBy(desc(collectionRequests.createdAt), desc(collectionRequests.id))
        : await db
            .select()
            .from(collectionRequests)
            .orderBy(desc(collectionRequests.createdAt), desc(collectionRequests.id));

    return await hydrateCollectionRequests(rows);
  } catch (error) {
    console.error('Database error in listAllCollectionRequestsAdmin:', error);
    throw new Error('Unable to load collection queue.', { cause: error });
  }
}

export async function listActiveAgentsAdmin() {
  try {
    const rows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        phoneNumber: users.phoneNumber,
        serviceZone: collectionAgentProfiles.serviceZone,
        isAvailable: collectionAgentProfiles.isAvailable,
      })
      .from(users)
      .leftJoin(collectionAgentProfiles, eq(collectionAgentProfiles.userId, users.id))
      .where(and(eq(users.role, 'AGENT'), eq(users.isActive, true)))
      .orderBy(asc(users.fullName));

    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phoneNumber: r.phoneNumber,
      serviceZone: r.serviceZone ?? 'FUTO & Owerri',
      isAvailable: r.isAvailable ?? true,
    }));
  } catch (error) {
    console.error('Database error in listActiveAgentsAdmin:', error);
    throw new Error('Unable to load collection agents.', { cause: error });
  }
}

export async function updateRequestReviewStatusAdmin(
  requestId: number,
  adminId: number,
  decision: 'APPROVED' | 'REJECTED',
  reason?: string
): Promise<HydratedCollectionRequest> {
  try {
    const updatedRow = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(collectionRequests)
        .where(eq(collectionRequests.id, requestId))
        .limit(1);

      if (!existing) {
        throw new NotFoundError('Collection request not found.');
      }

      const fromStatus = existing.status as CollectionRequestStatus;
      if (!canTransitionCollectionStatus(fromStatus, decision)) {
        throw new ValidationError(
          `Cannot move request from ${fromStatus} to ${decision}.`
        );
      }

      if (decision === 'REJECTED' && (!reason || reason.trim().length < 3)) {
        throw new ValidationError('Please provide a brief reason when rejecting a request.');
      }

      const [updated] = await tx
        .update(collectionRequests)
        .set({
          status: decision,
          statusReason: reason?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(collectionRequests.id, requestId))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action:
          decision === 'APPROVED'
            ? 'COLLECTION_REQUEST_APPROVED'
            : 'COLLECTION_REQUEST_REJECTED',
        targetType: 'COLLECTION_REQUEST',
        targetId: String(requestId),
        details: `${existing.referenceCode} moved from ${fromStatus} to ${decision}${reason ? `: ${reason.trim()}` : ''}`,
      });

      await createNotificationTx(tx, {
        userId: existing.userId,
        eventType: decision === 'APPROVED' ? 'COLLECTION_APPROVED' : 'COLLECTION_REJECTED',
        title:
          decision === 'APPROVED'
            ? `Collection Request Approved (${existing.referenceCode})`
            : `Collection Request Rejected (${existing.referenceCode})`,
        message:
          decision === 'APPROVED'
            ? 'Your collection request has been approved and is queued for agent assignment.'
            : `Your collection request was rejected. Reason: ${reason?.trim() || 'Not eligible.'}`,
        actionRoute: '/collections',
        relatedType: 'COLLECTION_REQUEST',
        relatedId: String(requestId),
      });

      return updated;
    });

    const [hydrated] = await hydrateCollectionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    console.error('Database error in updateRequestReviewStatusAdmin:', error);
    throw new Error('Could not update request status.', { cause: error });
  }
}

export async function assignAgentToRequestAdmin(
  requestId: number,
  agentUserId: number,
  adminId: number
): Promise<HydratedCollectionRequest> {
  try {
    const updatedRow = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(collectionRequests)
        .where(eq(collectionRequests.id, requestId))
        .limit(1);

      if (!existing) {
        throw new NotFoundError('Collection request not found.');
      }

      const fromStatus = existing.status as CollectionRequestStatus;
      if (!canTransitionCollectionStatus(fromStatus, 'ASSIGNED')) {
        throw new ValidationError(
          `Cannot assign an agent while request is in status ${fromStatus}.`
        );
      }

      const [agent] = await tx
        .select({ id: users.id, fullName: users.fullName, role: users.role, isActive: users.isActive })
        .from(users)
        .where(and(eq(users.id, agentUserId), eq(users.role, 'AGENT'), eq(users.isActive, true)))
        .limit(1);

      if (!agent) {
        throw new ValidationError('Selected user is not an active collection agent.');
      }

      await tx
        .update(collectionAssignments)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(
          and(
            eq(collectionAssignments.collectionRequestId, requestId),
            inArray(collectionAssignments.status, ['PENDING', 'ACCEPTED'])
          )
        );

      await tx.insert(collectionAssignments).values({
        collectionRequestId: requestId,
        agentUserId: agent.id,
        assignedByUserId: adminId,
        status: 'PENDING',
      });

      const [updated] = await tx
        .update(collectionRequests)
        .set({
          status: 'ASSIGNED',
          statusReason: null,
          updatedAt: new Date(),
        })
        .where(eq(collectionRequests.id, requestId))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'AGENT_ASSIGNED',
        targetType: 'COLLECTION_REQUEST',
        targetId: String(requestId),
        details: `${existing.referenceCode} assigned to agent ${agent.fullName} (user #${agent.id})`,
      });

      await createNotificationTx(tx, {
        userId: existing.userId,
        eventType: 'AGENT_ASSIGNED',
        title: `Collection Agent Assigned (${existing.referenceCode})`,
        message: `Agent ${agent.fullName} has been assigned to your collection request.`,
        actionRoute: '/collections',
        relatedType: 'COLLECTION_REQUEST',
        relatedId: String(requestId),
      });

      await createNotificationTx(tx, {
        userId: agent.id,
        eventType: 'AGENT_ASSIGNED',
        title: `New Assignment (${existing.referenceCode})`,
        message: `You have been assigned collection ${existing.referenceCode} in ${existing.communityArea}.`,
        actionRoute: '/agent',
        relatedType: 'COLLECTION_REQUEST',
        relatedId: String(requestId),
      });

      return updated;
    });

    const [hydrated] = await hydrateCollectionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    console.error('Database error in assignAgentToRequestAdmin:', error);
    throw new Error('Could not assign collection agent.', { cause: error });
  }
}

export async function reviewWeightVerificationAdmin(
  requestId: number,
  adminId: number,
  input: {
    decision: unknown;
    reviewNotes?: unknown;
  }
): Promise<HydratedCollectionRequest> {
  if (input.decision !== 'APPROVED' && input.decision !== 'REJECTED') {
    throw new ValidationError('Verification decision must be APPROVED or REJECTED.');
  }
  const decision = input.decision as VerificationDecision;
  const reviewNotes =
    typeof input.reviewNotes === 'string' && input.reviewNotes.trim().length > 0
      ? input.reviewNotes.trim().slice(0, 1000)
      : null;

  if (decision === 'REJECTED' && !reviewNotes) {
    throw new ValidationError('Please include review notes explaining why this weight record is rejected.');
  }

  try {
    const updatedRow = await db.transaction(async (tx) => {
      const [requestRow] = await tx
        .select()
        .from(collectionRequests)
        .where(eq(collectionRequests.id, requestId))
        .for('update')
        .limit(1);

      if (!requestRow) {
        throw new NotFoundError('Collection request not found.');
      }

      if (requestRow.userId === adminId) {
        throw new ForbiddenError('Administrators cannot verify their own collection submissions.');
      }

      const targetStatus: CollectionRequestStatus =
        decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED';

      if (
        requestRow.status !== 'AWAITING_VERIFICATION' ||
        !canTransitionCollectionStatus(requestRow.status as CollectionRequestStatus, targetStatus)
      ) {
        throw new ValidationError(
          `Request must be in AWAITING_VERIFICATION status before verification (current: ${requestRow.status}).`
        );
      }

      const [submission] = await tx
        .select()
        .from(wasteSubmissions)
        .where(eq(wasteSubmissions.collectionRequestId, requestId))
        .limit(1);

      if (!submission) {
        throw new ValidationError(
          'Cannot verify this request because no agent physical weight submission exists.'
        );
      }

      if (submission.recordedByAgentId === adminId) {
        throw new ForbiddenError(
          'The agent who recorded this physical weight cannot self-verify or approve it.'
        );
      }

      const [existingVerification] = await tx
        .select({ id: weightVerifications.id })
        .from(weightVerifications)
        .where(eq(weightVerifications.collectionRequestId, requestId))
        .limit(1);

      if (existingVerification) {
        throw new ValidationError('This collection request has already been verified.');
      }

      const verifiedEligibleWeightKg =
        decision === 'APPROVED' ? submission.eligibleWeightKg : '0.00';

      let appliedRewardRateId: number | null = null;
      let appliedPointsPerKg: string | null = null;
      let appliedRateIsDemo = false;
      let pointsAwarded = '0.00';
      let pointsCents = 0n;

      if (decision === 'APPROVED') {
        const activeRate = await getActiveRewardRateTx(tx, submission.materialCategoryId);
        if (!activeRate) {
          throw new ValidationError(
            'No active reward rate is configured for this material category. Configure a rate before approving verification.'
          );
        }
        appliedRewardRateId = activeRate.id;
        appliedPointsPerKg = activeRate.pointsPerKg;
        appliedRateIsDemo = activeRate.isDemo;

        const computed = calculateRewardPointsCents(
          verifiedEligibleWeightKg,
          activeRate.pointsPerKg
        );
        pointsCents = computed.pointsCents;
        pointsAwarded = computed.pointsFormatted;
      }

      const [verificationRow] = await tx
        .insert(weightVerifications)
        .values({
          submissionId: submission.id,
          collectionRequestId: requestId,
          verifiedByAdminId: adminId,
          decision,
          verifiedEligibleWeightKg,
          appliedRewardRateId,
          appliedPointsPerKg,
          appliedRateIsDemo,
          pointsAwarded,
          reviewNotes,
          verifiedAt: new Date(),
        })
        .returning();

      await tx
        .update(collectionAssignments)
        .set({ status: 'COMPLETED', updatedAt: new Date() })
        .where(eq(collectionAssignments.id, submission.assignmentId));

      const [updated] = await tx
        .update(collectionRequests)
        .set({
          status: targetStatus,
          statusReason: reviewNotes,
          updatedAt: new Date(),
        })
        .where(eq(collectionRequests.id, requestId))
        .returning();

      if (decision === 'APPROVED') {
        if (pointsCents > 0n) {
          await creditWalletLedgerTx(tx, {
            userId: requestRow.userId,
            amountCents: pointsCents,
            transactionType: 'COLLECTION_REWARD',
            idempotencyKey: `collection_reward:verification:${verificationRow.id}`,
            description: `Verified collection ${requestRow.referenceCode} (${verifiedEligibleWeightKg} kg × ${appliedPointsPerKg} pts/kg${appliedRateIsDemo ? ' [DEMO RATE]' : ''})`,
            verificationId: verificationRow.id,
            appliedRatePerKg: appliedPointsPerKg,
            actorUserId: adminId,
            isDemo: requestRow.isDemo || appliedRateIsDemo,
            incrementTotalEarned: true,
          });
        }

        // Stage 5: Automatic idempotent inventory receipt for verified material
        await receiveVerifiedMaterialToInventoryTx(tx, {
          verificationId: verificationRow.id,
          collectionRequestId: requestId,
          collectionReference: requestRow.referenceCode,
          materialCategoryId: submission.materialCategoryId,
          verifiedEligibleWeightKg,
          qualityGrade: submission.qualityGrade,
          adminId,
          isDemo: requestRow.isDemo,
        });

        await createNotificationTx(tx, {
          userId: requestRow.userId,
          eventType: 'VERIFICATION_APPROVED',
          title: `Collection Verified (${requestRow.referenceCode})`,
          message: `Your eligible weight of ${verifiedEligibleWeightKg} kg has been verified by KILN.${pointsCents > 0n ? ` ${pointsAwarded} reward points were credited to your wallet.` : ''}`,
          actionRoute: '/wallet',
          relatedType: 'WEIGHT_VERIFICATION',
          relatedId: String(verificationRow.id),
        });

        if (pointsCents > 0n) {
          await createNotificationTx(tx, {
            userId: requestRow.userId,
            eventType: 'REWARD_CREDITED',
            title: `Reward Points Credited (+${pointsAwarded} pts)`,
            message: `Earned from verified collection ${requestRow.referenceCode} at ${appliedPointsPerKg} pts/kg.`,
            actionRoute: '/wallet',
            relatedType: 'WEIGHT_VERIFICATION',
            relatedId: String(verificationRow.id),
          });
        }
      } else {
        await createNotificationTx(tx, {
          userId: requestRow.userId,
          eventType: 'VERIFICATION_REJECTED',
          title: `Verification Rejected (${requestRow.referenceCode})`,
          message: `Your weight submission was not approved for rewards. Reason: ${reviewNotes || 'See verification details.'}`,
          actionRoute: '/collections',
          relatedType: 'WEIGHT_VERIFICATION',
          relatedId: String(verificationRow.id),
        });
      }

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action:
          decision === 'APPROVED'
            ? 'WEIGHT_VERIFICATION_APPROVED'
            : 'WEIGHT_VERIFICATION_REJECTED',
        targetType: 'COLLECTION_REQUEST',
        targetId: String(requestId),
        details: `${requestRow.referenceCode} ${decision} · verified eligible ${verifiedEligibleWeightKg} kg · rate ${appliedPointsPerKg ?? 'N/A'} pts/kg · awarded ${pointsAwarded} pts`,
      });

      return updated;
    });

    const [hydrated] = await hydrateCollectionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    console.error('Database error in reviewWeightVerificationAdmin:', error);
    throw new Error('Could not complete weight verification.', { cause: error });
  }
}

// ============================================================
// COLLECTION AGENT WORKFLOWS (STRICTLY SCOPED TO AGENT)
// ============================================================

export async function listAgentAssignments(
  agentUserId: number,
  statusFilter?: string
): Promise<HydratedCollectionRequest[]> {
  try {
    const assignments = await db
      .select()
      .from(collectionAssignments)
      .where(
        and(
          eq(collectionAssignments.agentUserId, agentUserId),
          inArray(collectionAssignments.status, ['PENDING', 'ACCEPTED', 'COMPLETED'])
        )
      )
      .orderBy(desc(collectionAssignments.assignedAt), desc(collectionAssignments.id));

    if (!assignments.length) {
      return [];
    }

    const requestIds = Array.from(new Set(assignments.map((a) => a.collectionRequestId)));
    const conditions = [inArray(collectionRequests.id, requestIds)];
    if (statusFilter && statusFilter !== 'ALL') {
      conditions.push(eq(collectionRequests.status, statusFilter));
    }

    const rows = await db
      .select()
      .from(collectionRequests)
      .where(and(...conditions))
      .orderBy(desc(collectionRequests.updatedAt), desc(collectionRequests.id));

    return await hydrateCollectionRequests(rows);
  } catch (error) {
    console.error('Database error in listAgentAssignments:', error);
    throw new Error('Unable to load your assigned collections.', { cause: error });
  }
}

export async function respondToAssignmentAgent(
  assignmentId: number,
  agentUserId: number,
  decision: 'ACCEPT' | 'REJECT',
  note?: string
): Promise<HydratedCollectionRequest> {
  try {
    const updatedRow = await db.transaction(async (tx) => {
      const [assignment] = await tx
        .select()
        .from(collectionAssignments)
        .where(eq(collectionAssignments.id, assignmentId))
        .limit(1);

      if (!assignment) {
        throw new NotFoundError('Assignment record not found.');
      }
      if (assignment.agentUserId !== agentUserId) {
        throw new ForbiddenError('You cannot respond to another agent’s assignment.');
      }
      if (assignment.status !== 'PENDING') {
        throw new ValidationError(`This assignment has already been ${assignment.status.toLowerCase()}.`);
      }

      const [requestRow] = await tx
        .select()
        .from(collectionRequests)
        .where(eq(collectionRequests.id, assignment.collectionRequestId))
        .limit(1);

      if (!requestRow) {
        throw new NotFoundError('Linked collection request not found.');
      }

      const nextRequestStatus: CollectionRequestStatus =
        decision === 'ACCEPT' ? 'ACCEPTED_BY_AGENT' : 'APPROVED';

      if (
        !canTransitionCollectionStatus(
          requestRow.status as CollectionRequestStatus,
          nextRequestStatus
        )
      ) {
        throw new ValidationError(
          `Request in status ${requestRow.status} cannot move to ${nextRequestStatus}.`
        );
      }

      if (decision === 'REJECT' && (!note || note.trim().length < 3)) {
        throw new ValidationError('Please include a brief reason when rejecting an assignment.');
      }

      await tx
        .update(collectionAssignments)
        .set({
          status: decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
          agentResponseNote: note?.trim() || null,
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(collectionAssignments.id, assignment.id));

      const [updated] = await tx
        .update(collectionRequests)
        .set({
          status: nextRequestStatus,
          statusReason:
            decision === 'REJECT'
              ? `Agent declined assignment: ${note?.trim()}`
              : null,
          updatedAt: new Date(),
        })
        .where(eq(collectionRequests.id, requestRow.id))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: agentUserId,
        action: decision === 'ACCEPT' ? 'ASSIGNMENT_ACCEPTED' : 'ASSIGNMENT_REJECTED',
        targetType: 'COLLECTION_REQUEST',
        targetId: String(requestRow.id),
        details: `${requestRow.referenceCode} ${decision.toLowerCase()}ed by agent`,
      });

      if (decision === 'ACCEPT') {
        await createNotificationTx(tx, {
          userId: requestRow.userId,
          eventType: 'AGENT_ACCEPTED',
          title: `Agent Confirmed (${requestRow.referenceCode})`,
          message: 'Your assigned collection agent has accepted the request and will handle your handover.',
          actionRoute: '/collections',
          relatedType: 'COLLECTION_REQUEST',
          relatedId: String(requestRow.id),
        });
      }

      return updated;
    });

    const [hydrated] = await hydrateCollectionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    console.error('Database error in respondToAssignmentAgent:', error);
    throw new Error('Could not update assignment response.', { cause: error });
  }
}

export async function updateCollectionProgressAgent(
  assignmentId: number,
  agentUserId: number,
  nextStatus: 'IN_PROGRESS' | 'COLLECTED'
): Promise<HydratedCollectionRequest> {
  try {
    const updatedRow = await db.transaction(async (tx) => {
      const [assignment] = await tx
        .select()
        .from(collectionAssignments)
        .where(eq(collectionAssignments.id, assignmentId))
        .limit(1);

      if (!assignment) {
        throw new NotFoundError('Assignment record not found.');
      }
      if (assignment.agentUserId !== agentUserId) {
        throw new ForbiddenError('You cannot update another agent’s assignment.');
      }
      if (assignment.status !== 'ACCEPTED') {
        throw new ValidationError('Accept the assignment before updating collection progress.');
      }

      const [requestRow] = await tx
        .select()
        .from(collectionRequests)
        .where(eq(collectionRequests.id, assignment.collectionRequestId))
        .limit(1);

      if (!requestRow) {
        throw new NotFoundError('Collection request not found.');
      }

      if (!canTransitionCollectionStatus(requestRow.status as CollectionRequestStatus, nextStatus)) {
        throw new ValidationError(
          `Cannot move collection from ${requestRow.status} to ${nextStatus}.`
        );
      }

      await tx
        .update(collectionAssignments)
        .set({
          startedAt: nextStatus === 'IN_PROGRESS' ? new Date() : assignment.startedAt,
          collectedAt: nextStatus === 'COLLECTED' ? new Date() : assignment.collectedAt,
          updatedAt: new Date(),
        })
        .where(eq(collectionAssignments.id, assignment.id));

      const [updated] = await tx
        .update(collectionRequests)
        .set({
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(collectionRequests.id, requestRow.id))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: agentUserId,
        action: `COLLECTION_MARKED_${nextStatus}`,
        targetType: 'COLLECTION_REQUEST',
        targetId: String(requestRow.id),
        details: `${requestRow.referenceCode} updated to ${nextStatus}`,
      });

      await createNotificationTx(tx, {
        userId: requestRow.userId,
        eventType: nextStatus === 'COLLECTED' ? 'COLLECTION_COMPLETED' : 'COLLECTION_IN_PROGRESS',
        title:
          nextStatus === 'COLLECTED'
            ? `Materials Collected (${requestRow.referenceCode})`
            : `Collection In Progress (${requestRow.referenceCode})`,
        message:
          nextStatus === 'COLLECTED'
            ? 'Your materials have been collected and will be physically weighed shortly.'
            : 'Your collection agent has started processing your request.',
        actionRoute: '/collections',
        relatedType: 'COLLECTION_REQUEST',
        relatedId: String(requestRow.id),
      });

      return updated;
    });

    const [hydrated] = await hydrateCollectionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    console.error('Database error in updateCollectionProgressAgent:', error);
    throw new Error('Could not update collection status.', { cause: error });
  }
}

export async function submitWeightRecordAgent(
  assignmentId: number,
  agentUserId: number,
  input: {
    materialCategoryId?: unknown;
    actualWeightKg: unknown;
    rejectedWeightKg?: unknown;
    eligibleWeightKg?: unknown;
    qualityGrade: unknown;
    contaminationNotes?: unknown;
    agentNotes?: unknown;
    evidencePhotoUrl?: unknown;
  }
): Promise<HydratedCollectionRequest> {
  const weights = validateWeightTriplet({
    actualWeightKg: input.actualWeightKg,
    rejectedWeightKg: input.rejectedWeightKg,
    eligibleWeightKg: input.eligibleWeightKg,
  });

  if (!weights.ok) {
    throw new ValidationError(weights.error);
  }

  if (
    typeof input.qualityGrade !== 'string' ||
    !VALID_QUALITY_GRADES.has(input.qualityGrade as QualityGrade)
  ) {
    throw new ValidationError('Please select a valid quality grade.');
  }
  const qualityGrade = input.qualityGrade as QualityGrade;

  const photoCheck = validateUploadedPhoto(input.evidencePhotoUrl);
  if (!photoCheck.ok) {
    throw new ValidationError(photoCheck.error);
  }

  const contaminationNotes =
    typeof input.contaminationNotes === 'string' && input.contaminationNotes.trim().length > 0
      ? input.contaminationNotes.trim().slice(0, 1000)
      : null;

  const agentNotes =
    typeof input.agentNotes === 'string' && input.agentNotes.trim().length > 0
      ? input.agentNotes.trim().slice(0, 1000)
      : null;

  try {
    const updatedRow = await db.transaction(async (tx) => {
      const [assignment] = await tx
        .select()
        .from(collectionAssignments)
        .where(eq(collectionAssignments.id, assignmentId))
        .limit(1);

      if (!assignment) {
        throw new NotFoundError('Assignment record not found.');
      }
      if (assignment.agentUserId !== agentUserId) {
        throw new ForbiddenError('You cannot submit weight records for another agent’s assignment.');
      }
      if (assignment.status !== 'ACCEPTED') {
        throw new ValidationError('Assignment must be accepted before recording weight.');
      }

      const [requestRow] = await tx
        .select()
        .from(collectionRequests)
        .where(eq(collectionRequests.id, assignment.collectionRequestId))
        .limit(1);

      if (!requestRow) {
        throw new NotFoundError('Collection request not found.');
      }

      if (
        requestRow.status !== 'COLLECTED' ||
        !canTransitionCollectionStatus(
          requestRow.status as CollectionRequestStatus,
          'AWAITING_VERIFICATION'
        )
      ) {
        throw new ValidationError(
          `Mark the request as COLLECTED before submitting weight records (current: ${requestRow.status}).`
        );
      }

      const [existingSubmission] = await tx
        .select({ id: wasteSubmissions.id })
        .from(wasteSubmissions)
        .where(eq(wasteSubmissions.collectionRequestId, requestRow.id))
        .limit(1);

      if (existingSubmission) {
        throw new ValidationError('A weight submission has already been recorded for this request.');
      }

      const resolvedCategoryId = input.materialCategoryId
        ? Number(input.materialCategoryId)
        : requestRow.materialCategoryId;

      const [cat] = await tx
        .select({ id: materialCategories.id })
        .from(materialCategories)
        .where(
          and(
            eq(materialCategories.id, resolvedCategoryId),
            eq(materialCategories.streamType, 'RECYCLABLE'),
            eq(materialCategories.isActive, true)
          )
        )
        .limit(1);

      if (!cat) {
        throw new ValidationError('Selected recyclable material category is not active.');
      }

      await tx.insert(wasteSubmissions).values({
        collectionRequestId: requestRow.id,
        assignmentId: assignment.id,
        recordedByAgentId: agentUserId,
        materialCategoryId: cat.id,
        actualWeightKg: weights.value.actualWeightKg,
        rejectedWeightKg: weights.value.rejectedWeightKg,
        eligibleWeightKg: weights.value.eligibleWeightKg,
        qualityGrade,
        contaminationNotes,
        agentNotes,
        evidencePhotoUrl: photoCheck.value,
        collectedAt: assignment.collectedAt ?? new Date(),
      });

      const [updated] = await tx
        .update(collectionRequests)
        .set({
          status: 'AWAITING_VERIFICATION',
          updatedAt: new Date(),
        })
        .where(eq(collectionRequests.id, requestRow.id))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: agentUserId,
        action: 'WEIGHT_SUBMISSION_RECORDED',
        targetType: 'COLLECTION_REQUEST',
        targetId: String(requestRow.id),
        details: `${requestRow.referenceCode} weighed: actual ${weights.value.actualWeightKg} kg, rejected ${weights.value.rejectedWeightKg} kg, eligible ${weights.value.eligibleWeightKg} kg (${qualityGrade})`,
      });

      await createNotificationTx(tx, {
        userId: requestRow.userId,
        eventType: 'COLLECTION_COMPLETED',
        title: `Weight Recorded — Awaiting Verification (${requestRow.referenceCode})`,
        message: `Agent recorded ${weights.value.eligibleWeightKg} kg eligible weight (${weights.value.actualWeightKg} kg total). Awaiting administrator verification.`,
        actionRoute: '/collections',
        relatedType: 'COLLECTION_REQUEST',
        relatedId: String(requestRow.id),
      });

      await notifyActiveAdminsTx(tx, {
        eventType: 'ADMIN_PENDING_VERIFICATION',
        title: `Weight Awaiting Verification (${requestRow.referenceCode})`,
        message: `Eligible weight ${weights.value.eligibleWeightKg} kg (${qualityGrade}) submitted for verification.`,
        actionRoute: '/admin',
        relatedType: 'COLLECTION_REQUEST',
        relatedId: String(requestRow.id),
      });

      return updated;
    });

    const [hydrated] = await hydrateCollectionRequests([updatedRow]);
    return hydrated;
  } catch (error) {
    if (
      error instanceof NotFoundError ||
      error instanceof ForbiddenError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    console.error('Database error in submitWeightRecordAgent:', error);
    throw new Error('Could not submit physical weight record.', { cause: error });
  }
}

// ============================================================
// COLLECTION POINT MANAGEMENT (ADMIN + AVAILABLE FOR DROP-OFF)
// ============================================================

export async function listDropOffCollectionPoints() {
  try {
    return await db
      .select()
      .from(collectionPoints)
      .where(or(eq(collectionPoints.status, 'ACTIVE'), eq(collectionPoints.status, 'DEMO')))
      .orderBy(asc(collectionPoints.id));
  } catch (error) {
    console.error('Database error in listDropOffCollectionPoints:', error);
    throw new Error('Unable to load available drop-off points.', { cause: error });
  }
}

export async function listAllCollectionPointsAdmin() {
  try {
    return await db.select().from(collectionPoints).orderBy(asc(collectionPoints.id));
  } catch (error) {
    console.error('Database error in listAllCollectionPointsAdmin:', error);
    throw new Error('Unable to load collection points.', { cause: error });
  }
}

export async function createCollectionPointAdmin(
  adminId: number,
  input: {
    name: unknown;
    address: unknown;
    communityArea: unknown;
    description: unknown;
    contactInfo?: unknown;
    operatingHours: unknown;
    status: unknown;
    isDemo?: unknown;
  }
) {
  if (typeof input.name !== 'string' || input.name.trim().length < 3) {
    throw new ValidationError('Collection point name must be at least 3 characters.');
  }
  if (typeof input.address !== 'string' || input.address.trim().length < 5) {
    throw new ValidationError('Collection point address is required.');
  }
  if (typeof input.communityArea !== 'string' || input.communityArea.trim().length < 2) {
    throw new ValidationError('Community area is required.');
  }
  if (typeof input.description !== 'string' || input.description.trim().length < 5) {
    throw new ValidationError('Description is required.');
  }
  if (typeof input.operatingHours !== 'string' || input.operatingHours.trim().length < 3) {
    throw new ValidationError('Operating hours are required.');
  }
  const validStatuses = new Set<CollectionPointStatus>(['ACTIVE', 'DEMO', 'PLANNED', 'INACTIVE']);
  if (typeof input.status !== 'string' || !validStatuses.has(input.status as CollectionPointStatus)) {
    throw new ValidationError('Invalid collection point status.');
  }

  const name = input.name.trim();
  const address = input.address.trim();
  const communityArea = input.communityArea.trim();
  const description = input.description.trim();
  const operatingHours = input.operatingHours.trim();
  const status = input.status;
  const contactInfo =
    typeof input.contactInfo === 'string' && input.contactInfo.trim().length > 0
      ? input.contactInfo.trim()
      : null;
  const isDemo = input.isDemo === true || status === 'DEMO';

  const slug = `${slugifyName(name)}-${Date.now().toString(36).slice(-4)}`;

  try {
    const [created] = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(collectionPoints)
        .values({
          name,
          slug,
          address,
          communityArea,
          description,
          contactInfo,
          operatingHours,
          status,
          isDemo,
        })
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'COLLECTION_POINT_CREATED',
        targetType: 'COLLECTION_POINT',
        targetId: String(rows[0].id),
        details: `${rows[0].name} (${rows[0].status})`,
      });

      return rows;
    });

    return created;
  } catch (error) {
    console.error('Database error in createCollectionPointAdmin:', error);
    throw new Error('Could not create collection point.', { cause: error });
  }
}

export async function updateCollectionPointAdmin(
  pointId: number,
  adminId: number,
  input: {
    name?: unknown;
    address?: unknown;
    communityArea?: unknown;
    description?: unknown;
    contactInfo?: unknown;
    operatingHours?: unknown;
    status?: unknown;
    isDemo?: unknown;
  }
) {
  const validStatuses = new Set<CollectionPointStatus>(['ACTIVE', 'DEMO', 'PLANNED', 'INACTIVE']);

  try {
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(collectionPoints)
        .where(eq(collectionPoints.id, pointId))
        .limit(1);

      if (!existing) {
        throw new NotFoundError('Collection point not found.');
      }

      const nextStatus =
        typeof input.status === 'string' && validStatuses.has(input.status as CollectionPointStatus)
          ? input.status
          : existing.status;

      const [row] = await tx
        .update(collectionPoints)
        .set({
          name:
            typeof input.name === 'string' && input.name.trim().length >= 3
              ? input.name.trim()
              : existing.name,
          address:
            typeof input.address === 'string' && input.address.trim().length >= 5
              ? input.address.trim()
              : existing.address,
          communityArea:
            typeof input.communityArea === 'string' && input.communityArea.trim().length >= 2
              ? input.communityArea.trim()
              : existing.communityArea,
          description:
            typeof input.description === 'string' && input.description.trim().length >= 5
              ? input.description.trim()
              : existing.description,
          contactInfo:
            typeof input.contactInfo === 'string'
              ? input.contactInfo.trim() || null
              : existing.contactInfo,
          operatingHours:
            typeof input.operatingHours === 'string' && input.operatingHours.trim().length >= 3
              ? input.operatingHours.trim()
              : existing.operatingHours,
          status: nextStatus,
          isDemo: typeof input.isDemo === 'boolean' ? input.isDemo : existing.isDemo,
          updatedAt: new Date(),
        })
        .where(eq(collectionPoints.id, pointId))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'COLLECTION_POINT_UPDATED',
        targetType: 'COLLECTION_POINT',
        targetId: String(pointId),
        details: `${row.name} updated (status: ${row.status})`,
      });

      return row;
    });

    return updated;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      throw error;
    }
    console.error('Database error in updateCollectionPointAdmin:', error);
    throw new Error('Could not update collection point.', { cause: error });
  }
}
