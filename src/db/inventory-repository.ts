import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  batchSourceAllocations,
  collectionRequests,
  inventoryEntries,
  inventoryMovements,
  materialBatches,
  materialCategories,
  materialSales,
  materialTransfers,
  storageLocations,
  users,
  wasteSubmissions,
  weightVerifications,
  type BatchStatus,
  type SalePaymentStatus,
  type SaleTransferStatus,
  type TransferStatus,
} from './schema.ts';
import {
  formatCentigramsToKg,
  parseCentigrams,
  slugifyName,
} from '../lib/collection-rules.ts';
import {
  formatCentsToPoints,
  generateScopedReference,
  parseDecimalToScaledInt,
  parsePointsToCents,
  parseSignedDecimalToScaledInt,
} from '../lib/rewards-rules.ts';
import { NotFoundError, ValidationError } from './collection-repository.ts';

type PgTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ============================================================
// STORAGE LOCATIONS (STAGE 5)
// ============================================================

export async function getDefaultActiveStorageLocationTx(tx: PgTransaction) {
  const [loc] = await tx
    .select()
    .from(storageLocations)
    .where(eq(storageLocations.isActive, true))
    .orderBy(asc(storageLocations.id))
    .limit(1);

  if (loc) return loc;

  const [created] = await tx
    .insert(storageLocations)
    .values({
      name: 'FUTO Campus Pilot Holding Bay (Demo)',
      slug: 'futo-campus-holding-bay-demo',
      locationType: 'DEMO_STORAGE',
      address: 'Demo storage bay reference near FUTO Main Gate, Owerri West, Imo State',
      communityArea: 'FUTO Campus',
      description: 'Default pilot demonstration storage reference for verified collections.',
      capacityKg: '1500.00',
      isActive: true,
      isDemo: true,
    })
    .onConflictDoNothing({ target: storageLocations.slug })
    .returning();

  if (created) return created;

  const [fallback] = await tx.select().from(storageLocations).orderBy(asc(storageLocations.id)).limit(1);
  return fallback;
}

export async function listStorageLocationsAdmin() {
  try {
    const [locations, entries, batches] = await Promise.all([
      db.select().from(storageLocations).orderBy(asc(storageLocations.id)),
      db.select().from(inventoryEntries),
      db.select().from(materialBatches),
    ]);

    return locations.map((loc) => {
      let unbatchedAvailableCg = 0;
      let batchedAvailableCg = 0;
      for (const e of entries) {
        if (e.storageLocationId === loc.id) {
          unbatchedAvailableCg += parseCentigrams(e.availableWeightKg) ?? 0;
        }
      }
      for (const b of batches) {
        if (b.storageLocationId === loc.id) {
          batchedAvailableCg += parseCentigrams(b.availableWeightKg) ?? 0;
        }
      }
      return {
        ...loc,
        unbatchedAvailableKg: formatCentigramsToKg(unbatchedAvailableCg),
        batchedAvailableKg: formatCentigramsToKg(batchedAvailableCg),
        totalAvailableKg: formatCentigramsToKg(unbatchedAvailableCg + batchedAvailableCg),
      };
    });
  } catch (error) {
    console.error('Database error in listStorageLocationsAdmin:', error);
    throw new Error('Unable to load storage locations.', { cause: error });
  }
}

export async function createStorageLocationAdmin(
  adminId: number,
  input: {
    name: unknown;
    locationType?: unknown;
    address: unknown;
    communityArea: unknown;
    description: unknown;
    capacityKg?: unknown;
    isDemo?: unknown;
  }
) {
  if (typeof input.name !== 'string' || input.name.trim().length < 3) {
    throw new ValidationError('Storage location name must be at least 3 characters.');
  }
  if (typeof input.address !== 'string' || input.address.trim().length < 5) {
    throw new ValidationError('Storage location address or reference is required.');
  }
  if (typeof input.communityArea !== 'string' || input.communityArea.trim().length < 2) {
    throw new ValidationError('Community area is required.');
  }
  if (typeof input.description !== 'string' || input.description.trim().length < 5) {
    throw new ValidationError('Description is required.');
  }

  const name = input.name.trim().slice(0, 140);
  const address = input.address.trim().slice(0, 260);
  const communityArea = input.communityArea.trim().slice(0, 80);
  const description = input.description.trim().slice(0, 500);
  const locationType =
    typeof input.locationType === 'string' && input.locationType.trim()
      ? input.locationType.trim().slice(0, 40)
      : 'DEMO_STORAGE';
  const isDemo = typeof input.isDemo === 'boolean' ? input.isDemo : true;

  let capacityKg: string | null = null;
  if (input.capacityKg !== undefined && input.capacityKg !== null && input.capacityKg !== '') {
    const capCg = parseCentigrams(input.capacityKg);
    if (capCg === null || capCg <= 0) {
      throw new ValidationError('Storage capacity must be a positive number in kilograms.');
    }
    capacityKg = formatCentigramsToKg(capCg);
  }

  const slug = `${slugifyName(name)}-${Date.now().toString(36).slice(-4)}`;

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(storageLocations)
        .values({
          name,
          slug,
          locationType,
          address,
          communityArea,
          description,
          capacityKg,
          isActive: true,
          isDemo,
          createdByAdminId: adminId,
        })
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'STORAGE_LOCATION_CREATED',
        targetType: 'STORAGE_LOCATION',
        targetId: String(created.id),
        details: `${created.name} (${created.communityArea})`,
      });

      return created;
    });
  } catch (error) {
    console.error('Database error in createStorageLocationAdmin:', error);
    throw new Error('Could not create storage location.', { cause: error });
  }
}

export async function updateStorageLocationAdmin(
  locationId: number,
  adminId: number,
  input: {
    name?: unknown;
    address?: unknown;
    description?: unknown;
    isActive?: unknown;
    capacityKg?: unknown;
  }
) {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(storageLocations)
        .where(eq(storageLocations.id, locationId))
        .limit(1);

      if (!existing) throw new NotFoundError('Storage location not found.');

      const updates: Partial<typeof storageLocations.$inferInsert> = { updatedAt: new Date() };
      if (typeof input.name === 'string' && input.name.trim().length >= 3) {
        updates.name = input.name.trim().slice(0, 140);
      }
      if (typeof input.address === 'string' && input.address.trim().length >= 5) {
        updates.address = input.address.trim().slice(0, 260);
      }
      if (typeof input.description === 'string' && input.description.trim().length >= 5) {
        updates.description = input.description.trim().slice(0, 500);
      }
      if (typeof input.isActive === 'boolean') {
        updates.isActive = input.isActive;
      }
      if (input.capacityKg !== undefined) {
        if (input.capacityKg === '' || input.capacityKg === null) {
          updates.capacityKg = null;
        } else {
          const capCg = parseCentigrams(input.capacityKg);
          if (capCg === null || capCg <= 0) {
            throw new ValidationError('Capacity must be a positive kilogram amount.');
          }
          updates.capacityKg = formatCentigramsToKg(capCg);
        }
      }

      const [updated] = await tx
        .update(storageLocations)
        .set(updates)
        .where(eq(storageLocations.id, locationId))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'STORAGE_LOCATION_UPDATED',
        targetType: 'STORAGE_LOCATION',
        targetId: String(locationId),
        details: `${updated.name} (active: ${updated.isActive})`,
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in updateStorageLocationAdmin:', error);
    throw new Error('Could not update storage location.', { cause: error });
  }
}

// ============================================================
// AUTOMATIC VERIFIED INVENTORY RECEIPT (IDEMPOTENT)
// ============================================================

export async function receiveVerifiedMaterialToInventoryTx(
  tx: PgTransaction,
  params: {
    verificationId: number;
    collectionRequestId: number;
    collectionReference: string;
    materialCategoryId: number;
    verifiedEligibleWeightKg: string;
    qualityGrade: string;
    adminId: number;
    isDemo: boolean;
  }
) {
  const cg = parseCentigrams(params.verifiedEligibleWeightKg) ?? 0;
  if (cg <= 0) {
    return null;
  }

  // Prevent duplicate receipt via unique verificationId
  const [existing] = await tx
    .select()
    .from(inventoryEntries)
    .where(eq(inventoryEntries.verificationId, params.verificationId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const location = await getDefaultActiveStorageLocationTx(tx);
  const referenceCode = generateScopedReference('KINV');

  const [entry] = await tx
    .insert(inventoryEntries)
    .values({
      referenceCode,
      verificationId: params.verificationId,
      collectionRequestId: params.collectionRequestId,
      materialCategoryId: params.materialCategoryId,
      storageLocationId: location.id,
      qualityGrade: params.qualityGrade,
      initialWeightKg: params.verifiedEligibleWeightKg,
      availableWeightKg: params.verifiedEligibleWeightKg,
      reservedWeightKg: '0.00',
      status: 'RECEIVED',
      isDemo: params.isDemo,
      notes: `Auto-received from verified collection ${params.collectionReference}`,
    })
    .returning();

  await tx.insert(inventoryMovements).values({
    referenceCode: generateScopedReference('KMOV'),
    movementType: 'RECEIPT',
    materialCategoryId: params.materialCategoryId,
    inventoryEntryId: entry.id,
    toLocationId: location.id,
    quantityDeltaKg: params.verifiedEligibleWeightKg,
    reason: `Receipt of verified collection ${params.collectionReference}`,
    actorUserId: params.adminId,
  });

  return entry;
}

// ============================================================
// INVENTORY QUERIES & MANUAL ADJUSTMENT
// ============================================================

export async function listInventoryEntriesAdmin(filters?: {
  materialCategoryId?: number;
  storageLocationId?: number;
  status?: string;
}) {
  try {
    const conditions = [];
    if (filters?.materialCategoryId) {
      conditions.push(eq(inventoryEntries.materialCategoryId, filters.materialCategoryId));
    }
    if (filters?.storageLocationId) {
      conditions.push(eq(inventoryEntries.storageLocationId, filters.storageLocationId));
    }
    if (filters?.status && filters.status !== 'ALL') {
      conditions.push(eq(inventoryEntries.status, filters.status));
    }

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(inventoryEntries)
            .where(and(...conditions))
            .orderBy(desc(inventoryEntries.receivedAt), desc(inventoryEntries.id))
        : await db
            .select()
            .from(inventoryEntries)
            .orderBy(desc(inventoryEntries.receivedAt), desc(inventoryEntries.id));

    if (!rows.length) return [];

    const reqIds = Array.from(new Set(rows.map((r) => r.collectionRequestId)));
    const [cats, locs, reqs, batches] = await Promise.all([
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
      db.select({ id: storageLocations.id, name: storageLocations.name }).from(storageLocations),
      db
        .select({
          id: collectionRequests.id,
          referenceCode: collectionRequests.referenceCode,
        })
        .from(collectionRequests)
        .where(inArray(collectionRequests.id, reqIds)),
      db
        .select({ id: materialBatches.id, batchReference: materialBatches.batchReference })
        .from(materialBatches),
    ]);

    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const locMap = new Map(locs.map((l) => [l.id, l.name]));
    const reqMap = new Map(reqs.map((r) => [r.id, r.referenceCode]));
    const batchMap = new Map(batches.map((b) => [b.id, b.batchReference]));

    return rows.map((r) => ({
      ...r,
      materialName: catMap.get(r.materialCategoryId) ?? 'Unknown',
      storageLocationName: locMap.get(r.storageLocationId) ?? 'Unknown',
      collectionReference: reqMap.get(r.collectionRequestId) ?? `#${r.collectionRequestId}`,
      batchReference: r.batchId ? batchMap.get(r.batchId) ?? null : null,
    }));
  } catch (error) {
    console.error('Database error in listInventoryEntriesAdmin:', error);
    throw new Error('Unable to load inventory entries.', { cause: error });
  }
}

export async function adjustInventoryEntryAdmin(
  entryId: number,
  adminId: number,
  input: {
    quantityDeltaKg: unknown;
    reason: unknown;
    nextStatus?: unknown;
  }
) {
  const deltaBig = parseSignedDecimalToScaledInt(input.quantityDeltaKg, 2);
  if (deltaBig === null) {
    throw new ValidationError('Provide a valid decimal kilogram adjustment (e.g. -0.50 or 1.00).');
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length < 5) {
    throw new ValidationError('Provide an administrative justification (at least 5 characters).');
  }
  const reason = input.reason.trim().slice(0, 500);
  const deltaCg = Number(deltaBig);

  try {
    return await db.transaction(async (tx) => {
      const lock = await tx.execute(
        sql`SELECT id FROM inventory_entries WHERE id = ${entryId} FOR UPDATE`
      );
      if (!lock.rows.length) throw new NotFoundError('Inventory entry not found.');

      const [entry] = await tx
        .select()
        .from(inventoryEntries)
        .where(eq(inventoryEntries.id, entryId))
        .limit(1);

      const currentCg = parseCentigrams(entry.availableWeightKg) ?? 0;
      const nextCg = currentCg + deltaCg;
      if (nextCg < 0) {
        throw new ValidationError(
          `Adjustment rejected: available inventory cannot become negative (current: ${entry.availableWeightKg} kg).`
        );
      }

      const validStatuses = new Set(['RECEIVED', 'SORTED', 'STORED', 'REJECTED']);
      const resolvedStatus =
        typeof input.nextStatus === 'string' && validStatuses.has(input.nextStatus)
          ? input.nextStatus
          : entry.status;

      const [updated] = await tx
        .update(inventoryEntries)
        .set({
          availableWeightKg: formatCentigramsToKg(nextCg),
          status: resolvedStatus,
          updatedAt: new Date(),
        })
        .where(eq(inventoryEntries.id, entryId))
        .returning();

      await tx.insert(inventoryMovements).values({
        referenceCode: generateScopedReference('KMOV'),
        movementType: 'ADJUSTMENT',
        materialCategoryId: entry.materialCategoryId,
        inventoryEntryId: entry.id,
        fromLocationId: entry.storageLocationId,
        toLocationId: entry.storageLocationId,
        quantityDeltaKg: formatCentsToPoints(deltaBig),
        reason,
        actorUserId: adminId,
      });

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'INVENTORY_ADJUSTED',
        targetType: 'INVENTORY_ENTRY',
        targetId: String(entry.id),
        details: `${entry.referenceCode} delta ${formatCentsToPoints(deltaBig)} kg (${entry.availableWeightKg} -> ${updated.availableWeightKg} kg). Reason: ${reason}`,
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in adjustInventoryEntryAdmin:', error);
    throw new Error('Could not record inventory adjustment.', { cause: error });
  }
}

// ============================================================
// MATERIAL BATCHES & CONSOLIDATION (FULL TRACEABILITY)
// ============================================================

export async function createMaterialBatchAdmin(
  adminId: number,
  input: {
    inventoryEntryIds: unknown;
    storageLocationId?: unknown;
    notes?: unknown;
  }
) {
  if (!Array.isArray(input.inventoryEntryIds) || input.inventoryEntryIds.length === 0) {
    throw new ValidationError('Select at least one available inventory entry to form a batch.');
  }

  const entryIds = Array.from(
    new Set(
      input.inventoryEntryIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
  if (entryIds.length === 0) {
    throw new ValidationError('Invalid inventory entry selection.');
  }

  const notes =
    typeof input.notes === 'string' && input.notes.trim().length > 0
      ? input.notes.trim().slice(0, 600)
      : null;

  try {
    return await db.transaction(async (tx) => {
      // Lock selected inventory rows to prevent double allocation
      await tx.execute(
        sql`SELECT id FROM inventory_entries WHERE id = ANY(ARRAY[${sql.join(
          entryIds.map((id) => sql`${id}`),
          sql`, `
        )}]::int[]) FOR UPDATE`
      );

      const entries = await tx
        .select()
        .from(inventoryEntries)
        .where(inArray(inventoryEntries.id, entryIds));

      if (entries.length !== entryIds.length) {
        throw new NotFoundError('One or more selected inventory entries were not found.');
      }

      const categoryId = entries[0].materialCategoryId;
      let totalCg = 0;
      let hasDemo = false;

      for (const e of entries) {
        if (e.materialCategoryId !== categoryId) {
          throw new ValidationError(
            'Cannot mix incompatible material categories into a single batch.'
          );
        }
        const availCg = parseCentigrams(e.availableWeightKg) ?? 0;
        if (availCg <= 0) {
          throw new ValidationError(
            `Inventory entry ${e.referenceCode} has no available unbatched weight remaining.`
          );
        }
        if (e.status === 'BATCHED' || e.status === 'SOLD' || e.status === 'TRANSFERRED') {
          throw new ValidationError(
            `Inventory entry ${e.referenceCode} is already ${e.status} and cannot be double-allocated.`
          );
        }
        totalCg += availCg;
        if (e.isDemo) hasDemo = true;
      }

      let locationId = entries[0].storageLocationId;
      if (input.storageLocationId) {
        const parsedLoc = Number(input.storageLocationId);
        const [loc] = await tx
          .select({ id: storageLocations.id })
          .from(storageLocations)
          .where(and(eq(storageLocations.id, parsedLoc), eq(storageLocations.isActive, true)))
          .limit(1);
        if (!loc) {
          throw new ValidationError('Selected storage location is not active.');
        }
        locationId = loc.id;
      }

      const totalKg = formatCentigramsToKg(totalCg);
      const batchReference = generateScopedReference('KBAT');

      const [batch] = await tx
        .insert(materialBatches)
        .values({
          batchReference,
          materialCategoryId: categoryId,
          storageLocationId: locationId,
          totalWeightKg: totalKg,
          availableWeightKg: totalKg,
          reservedWeightKg: '0.00',
          status: 'STORED',
          createdByAdminId: adminId,
          notes,
          isDemo: hasDemo,
        })
        .returning();

      for (const e of entries) {
        const allocatedKg = e.availableWeightKg;
        await tx.insert(batchSourceAllocations).values({
          batchId: batch.id,
          inventoryEntryId: e.id,
          verificationId: e.verificationId,
          collectionRequestId: e.collectionRequestId,
          allocatedWeightKg: allocatedKg,
        });

        await tx
          .update(inventoryEntries)
          .set({
            availableWeightKg: '0.00',
            status: 'BATCHED',
            batchId: batch.id,
            storageLocationId: locationId,
            updatedAt: new Date(),
          })
          .where(eq(inventoryEntries.id, e.id));

        await tx.insert(inventoryMovements).values({
          referenceCode: generateScopedReference('KMOV'),
          movementType: 'CONSOLIDATION',
          materialCategoryId: categoryId,
          inventoryEntryId: e.id,
          batchId: batch.id,
          fromLocationId: e.storageLocationId,
          toLocationId: locationId,
          quantityDeltaKg: allocatedKg,
          reason: `Allocated ${e.referenceCode} into batch ${batchReference}`,
          actorUserId: adminId,
        });
      }

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'MATERIAL_BATCH_CREATED',
        targetType: 'MATERIAL_BATCH',
        targetId: String(batch.id),
        details: `${batchReference} created with ${totalKg} kg from ${entries.length} verified entries`,
      });

      return batch;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in createMaterialBatchAdmin:', error);
    throw new Error('Could not create material batch.', { cause: error });
  }
}

/**
 * Consolidates two or more compatible batches into one new consolidated batch,
 * preserving every originating collection & verification traceability link!
 */
export async function consolidateBatchesAdmin(
  adminId: number,
  input: {
    batchIds: unknown;
    storageLocationId?: unknown;
    notes?: unknown;
  }
) {
  if (!Array.isArray(input.batchIds) || input.batchIds.length < 2) {
    throw new ValidationError('Select at least two compatible batches to consolidate.');
  }
  const batchIds = Array.from(
    new Set(
      input.batchIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    )
  );
  if (batchIds.length < 2) {
    throw new ValidationError('Select at least two distinct batches to consolidate.');
  }
  const notes =
    typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 600) : null;

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM material_batches WHERE id = ANY(ARRAY[${sql.join(
          batchIds.map((id) => sql`${id}`),
          sql`, `
        )}]::int[]) FOR UPDATE`
      );

      const batches = await tx
        .select()
        .from(materialBatches)
        .where(inArray(materialBatches.id, batchIds));

      if (batches.length !== batchIds.length) {
        throw new NotFoundError('One or more selected batches could not be found.');
      }

      const categoryId = batches[0].materialCategoryId;
      let totalCg = 0;
      let hasDemo = false;

      for (const b of batches) {
        if (b.materialCategoryId !== categoryId) {
          throw new ValidationError('Only batches of the same material category can be consolidated.');
        }
        const availCg = parseCentigrams(b.availableWeightKg) ?? 0;
        const reservedCg = parseCentigrams(b.reservedWeightKg) ?? 0;
        if (reservedCg > 0) {
          throw new ValidationError(
            `Batch ${b.batchReference} has reserved weight (${b.reservedWeightKg} kg) and cannot be consolidated while in transit.`
          );
        }
        if (availCg <= 0 || b.status === 'SOLD' || b.status === 'CLOSED') {
          throw new ValidationError(
            `Batch ${b.batchReference} has no available stock for consolidation.`
          );
        }
        totalCg += availCg;
        if (b.isDemo) hasDemo = true;
      }

      const targetLocationId =
        input.storageLocationId && Number.isInteger(Number(input.storageLocationId))
          ? Number(input.storageLocationId)
          : batches[0].storageLocationId;

      const consolidatedRef = generateScopedReference('KBAT');
      const totalKg = formatCentigramsToKg(totalCg);

      const [newBatch] = await tx
        .insert(materialBatches)
        .values({
          batchReference: consolidatedRef,
          materialCategoryId: categoryId,
          storageLocationId: targetLocationId,
          totalWeightKg: totalKg,
          availableWeightKg: totalKg,
          reservedWeightKg: '0.00',
          status: 'STORED',
          createdByAdminId: adminId,
          notes:
            notes ||
            `Consolidated from ${batches.map((b) => b.batchReference).join(', ')}`,
          isDemo: hasDemo,
        })
        .returning();

      // Carry forward all original batch_source_allocations so source traceability is never lost!
      const priorAllocations = await tx
        .select()
        .from(batchSourceAllocations)
        .where(inArray(batchSourceAllocations.batchId, batchIds));

      for (const alloc of priorAllocations) {
        await tx.insert(batchSourceAllocations).values({
          batchId: newBatch.id,
          inventoryEntryId: alloc.inventoryEntryId,
          verificationId: alloc.verificationId,
          collectionRequestId: alloc.collectionRequestId,
          allocatedWeightKg: alloc.allocatedWeightKg,
        });
      }

      for (const oldBatch of batches) {
        await tx
          .update(materialBatches)
          .set({
            availableWeightKg: '0.00',
            status: 'CLOSED',
            notes: `${oldBatch.notes ? `${oldBatch.notes} · ` : ''}Consolidated into ${consolidatedRef}`,
            updatedAt: new Date(),
          })
          .where(eq(materialBatches.id, oldBatch.id));

        await tx.insert(inventoryMovements).values({
          referenceCode: generateScopedReference('KMOV'),
          movementType: 'CONSOLIDATION',
          materialCategoryId: categoryId,
          batchId: newBatch.id,
          fromLocationId: oldBatch.storageLocationId,
          toLocationId: targetLocationId,
          quantityDeltaKg: oldBatch.availableWeightKg,
          reason: `Consolidated ${oldBatch.batchReference} into ${consolidatedRef}`,
          actorUserId: adminId,
        });
      }

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'MATERIAL_BATCHES_CONSOLIDATED',
        targetType: 'MATERIAL_BATCH',
        targetId: String(newBatch.id),
        details: `${consolidatedRef} (${totalKg} kg) consolidated from ${batches
          .map((b) => b.batchReference)
          .join(', ')}`,
      });

      return newBatch;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in consolidateBatchesAdmin:', error);
    throw new Error('Could not consolidate batches.', { cause: error });
  }
}

export async function listMaterialBatchesAdmin(filters?: {
  materialCategoryId?: number;
  storageLocationId?: number;
  status?: string;
}) {
  try {
    const conditions = [];
    if (filters?.materialCategoryId) {
      conditions.push(eq(materialBatches.materialCategoryId, filters.materialCategoryId));
    }
    if (filters?.storageLocationId) {
      conditions.push(eq(materialBatches.storageLocationId, filters.storageLocationId));
    }
    if (filters?.status && filters.status !== 'ALL') {
      conditions.push(eq(materialBatches.status, filters.status));
    }

    const batches =
      conditions.length > 0
        ? await db
            .select()
            .from(materialBatches)
            .where(and(...conditions))
            .orderBy(desc(materialBatches.createdAt), desc(materialBatches.id))
        : await db
            .select()
            .from(materialBatches)
            .orderBy(desc(materialBatches.createdAt), desc(materialBatches.id));

    if (!batches.length) return [];

    const batchIds = batches.map((b) => b.id);
    const [cats, locs, allocations] = await Promise.all([
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
      db.select({ id: storageLocations.id, name: storageLocations.name }).from(storageLocations),
      db
        .select()
        .from(batchSourceAllocations)
        .where(inArray(batchSourceAllocations.batchId, batchIds)),
    ]);

    const reqIds = Array.from(new Set(allocations.map((a) => a.collectionRequestId)));
    const reqRows = reqIds.length
      ? await db
          .select({
            id: collectionRequests.id,
            referenceCode: collectionRequests.referenceCode,
            communityArea: collectionRequests.communityArea,
          })
          .from(collectionRequests)
          .where(inArray(collectionRequests.id, reqIds))
      : [];

    const subRows = reqIds.length
      ? await db
          .select({
            collectionRequestId: wasteSubmissions.collectionRequestId,
            recordedByAgentId: wasteSubmissions.recordedByAgentId,
            qualityGrade: wasteSubmissions.qualityGrade,
            collectedAt: wasteSubmissions.collectedAt,
          })
          .from(wasteSubmissions)
          .where(inArray(wasteSubmissions.collectionRequestId, reqIds))
      : [];

    const verRows = reqIds.length
      ? await db
          .select({
            id: weightVerifications.id,
            collectionRequestId: weightVerifications.collectionRequestId,
            verifiedEligibleWeightKg: weightVerifications.verifiedEligibleWeightKg,
            verifiedAt: weightVerifications.verifiedAt,
          })
          .from(weightVerifications)
          .where(inArray(weightVerifications.collectionRequestId, reqIds))
      : [];

    const agentIds = Array.from(new Set(subRows.map((s) => s.recordedByAgentId)));
    const agentRows = agentIds.length
      ? await db
          .select({ id: users.id, fullName: users.fullName })
          .from(users)
          .where(inArray(users.id, agentIds))
      : [];

    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const locMap = new Map(locs.map((l) => [l.id, l.name]));
    const reqMap = new Map(reqRows.map((r) => [r.id, r]));
    const subMap = new Map(subRows.map((s) => [s.collectionRequestId, s]));
    const verMap = new Map(verRows.map((v) => [v.id, v]));
    const agentMap = new Map(agentRows.map((a) => [a.id, a.fullName]));

    const allocByBatch = new Map<number, typeof allocations>();
    for (const a of allocations) {
      const list = allocByBatch.get(a.batchId) ?? [];
      list.push(a);
      allocByBatch.set(a.batchId, list);
    }

    return batches.map((b) => ({
      ...b,
      status: b.status as BatchStatus,
      materialName: catMap.get(b.materialCategoryId) ?? 'Unknown',
      storageLocationName: locMap.get(b.storageLocationId) ?? 'Unknown',
      sourceTraceability: (allocByBatch.get(b.id) ?? []).map((a) => {
        const req = reqMap.get(a.collectionRequestId);
        const sub = subMap.get(a.collectionRequestId);
        const ver = verMap.get(a.verificationId);
        return {
          allocationId: a.id,
          inventoryEntryId: a.inventoryEntryId,
          verificationId: a.verificationId,
          collectionRequestId: a.collectionRequestId,
          collectionReference: req?.referenceCode ?? `#${a.collectionRequestId}`,
          communityArea: req?.communityArea ?? '',
          agentName: sub ? agentMap.get(sub.recordedByAgentId) ?? 'Agent' : 'Agent',
          qualityGrade: sub?.qualityGrade ?? '',
          allocatedWeightKg: a.allocatedWeightKg,
          verifiedAt: ver?.verifiedAt ?? a.createdAt,
        };
      }),
    }));
  } catch (error) {
    console.error('Database error in listMaterialBatchesAdmin:', error);
    throw new Error('Unable to load material batches.', { cause: error });
  }
}

// ============================================================
// MATERIAL TRANSFERS BETWEEN LOCATIONS
// ============================================================

export async function createMaterialTransferAdmin(
  adminId: number,
  input: {
    batchId: unknown;
    destinationLocationId: unknown;
    quantityKg?: unknown;
    responsibleParty: unknown;
    notes?: unknown;
  }
) {
  const batchId = Number(input.batchId);
  const destId = Number(input.destinationLocationId);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    throw new ValidationError('Select a valid material batch.');
  }
  if (!Number.isInteger(destId) || destId <= 0) {
    throw new ValidationError('Select a valid destination storage location.');
  }
  if (typeof input.responsibleParty !== 'string' || input.responsibleParty.trim().length < 2) {
    throw new ValidationError('Specify the person or party responsible for the transfer.');
  }
  const responsibleParty = input.responsibleParty.trim().slice(0, 140);
  const notes =
    typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 500) : null;

  try {
    return await db.transaction(async (tx) => {
      const lock = await tx.execute(
        sql`SELECT id FROM material_batches WHERE id = ${batchId} FOR UPDATE`
      );
      if (!lock.rows.length) throw new NotFoundError('Material batch not found.');

      const [batch] = await tx
        .select()
        .from(materialBatches)
        .where(eq(materialBatches.id, batchId))
        .limit(1);

      if (batch.storageLocationId === destId) {
        throw new ValidationError('Destination storage location must differ from current location.');
      }

      const [destLoc] = await tx
        .select()
        .from(storageLocations)
        .where(and(eq(storageLocations.id, destId), eq(storageLocations.isActive, true)))
        .limit(1);
      if (!destLoc) throw new ValidationError('Destination storage location is not active.');

      const availCg = parseCentigrams(batch.availableWeightKg) ?? 0;
      const qtyCg =
        input.quantityKg !== undefined && input.quantityKg !== ''
          ? parseCentigrams(input.quantityKg)
          : availCg;

      if (qtyCg === null || qtyCg <= 0) {
        throw new ValidationError('Transfer quantity must be greater than 0 kg.');
      }
      if (qtyCg > availCg) {
        throw new ValidationError(
          `Transfer quantity (${formatCentigramsToKg(qtyCg)} kg) exceeds batch available stock (${batch.availableWeightKg} kg).`
        );
      }

      const qtyKg = formatCentigramsToKg(qtyCg);
      const nextAvail = formatCentigramsToKg(availCg - qtyCg);
      const nextReserved = formatCentigramsToKg((parseCentigrams(batch.reservedWeightKg) ?? 0) + qtyCg);
      const referenceCode = generateScopedReference('KTRF');

      const [transfer] = await tx
        .insert(materialTransfers)
        .values({
          referenceCode,
          batchId: batch.id,
          materialCategoryId: batch.materialCategoryId,
          sourceLocationId: batch.storageLocationId,
          destinationLocationId: destId,
          quantityKg: qtyKg,
          status: 'PENDING',
          responsibleParty,
          notes,
          initiatedByAdminId: adminId,
        })
        .returning();

      await tx
        .update(materialBatches)
        .set({
          availableWeightKg: nextAvail,
          reservedWeightKg: nextReserved,
          status: 'READY_FOR_TRANSFER',
          updatedAt: new Date(),
        })
        .where(eq(materialBatches.id, batch.id));

      await tx.insert(inventoryMovements).values({
        referenceCode: generateScopedReference('KMOV'),
        movementType: 'RESERVATION',
        materialCategoryId: batch.materialCategoryId,
        batchId: batch.id,
        fromLocationId: batch.storageLocationId,
        toLocationId: destId,
        quantityDeltaKg: `-${qtyKg}`,
        reason: `Reserved for transfer ${referenceCode} to ${destLoc.name}`,
        actorUserId: adminId,
      });

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'MATERIAL_TRANSFER_CREATED',
        targetType: 'MATERIAL_TRANSFER',
        targetId: String(transfer.id),
        details: `${referenceCode} · ${batch.batchReference} · ${qtyKg} kg -> ${destLoc.name}`,
      });

      return transfer;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in createMaterialTransferAdmin:', error);
    throw new Error('Could not create material transfer.', { cause: error });
  }
}

export async function updateMaterialTransferStatusAdmin(
  transferId: number,
  adminId: number,
  nextStatusInput: unknown
) {
  const validNext = new Set<TransferStatus>(['IN_TRANSIT', 'CONFIRMED', 'CANCELLED']);
  if (typeof nextStatusInput !== 'string' || !validNext.has(nextStatusInput as TransferStatus)) {
    throw new ValidationError('Transfer status must be IN_TRANSIT, CONFIRMED, or CANCELLED.');
  }
  const nextStatus = nextStatusInput as TransferStatus;

  try {
    return await db.transaction(async (tx) => {
      const lock = await tx.execute(
        sql`SELECT id FROM material_transfers WHERE id = ${transferId} FOR UPDATE`
      );
      if (!lock.rows.length) throw new NotFoundError('Transfer record not found.');

      const [transfer] = await tx
        .select()
        .from(materialTransfers)
        .where(eq(materialTransfers.id, transferId))
        .limit(1);

      if (transfer.status === 'CONFIRMED' || transfer.status === 'CANCELLED') {
        throw new ValidationError(`Transfer ${transfer.referenceCode} is already ${transfer.status}.`);
      }

      const [batch] = await tx
        .select()
        .from(materialBatches)
        .where(eq(materialBatches.id, transfer.batchId))
        .limit(1);

      const qtyCg = parseCentigrams(transfer.quantityKg) ?? 0;
      const availCg = parseCentigrams(batch.availableWeightKg) ?? 0;
      const reservedCg = parseCentigrams(batch.reservedWeightKg) ?? 0;
      const now = new Date();

      if (nextStatus === 'CONFIRMED') {
        const nextReserved = Math.max(0, reservedCg - qtyCg);
        const nextAvail = availCg + qtyCg;
        await tx
          .update(materialBatches)
          .set({
            storageLocationId: transfer.destinationLocationId,
            availableWeightKg: formatCentigramsToKg(nextAvail),
            reservedWeightKg: formatCentigramsToKg(nextReserved),
            status: 'STORED',
            updatedAt: now,
          })
          .where(eq(materialBatches.id, batch.id));

        await tx.insert(inventoryMovements).values({
          referenceCode: generateScopedReference('KMOV'),
          movementType: 'LOCATION_TRANSFER',
          materialCategoryId: transfer.materialCategoryId,
          batchId: batch.id,
          fromLocationId: transfer.sourceLocationId,
          toLocationId: transfer.destinationLocationId,
          quantityDeltaKg: transfer.quantityKg,
          reason: `Confirmed transfer ${transfer.referenceCode}`,
          actorUserId: adminId,
        });
      } else if (nextStatus === 'CANCELLED') {
        const nextReserved = Math.max(0, reservedCg - qtyCg);
        const nextAvail = availCg + qtyCg;
        await tx
          .update(materialBatches)
          .set({
            availableWeightKg: formatCentigramsToKg(nextAvail),
            reservedWeightKg: formatCentigramsToKg(nextReserved),
            status: 'STORED',
            updatedAt: now,
          })
          .where(eq(materialBatches.id, batch.id));

        await tx.insert(inventoryMovements).values({
          referenceCode: generateScopedReference('KMOV'),
          movementType: 'ADJUSTMENT',
          materialCategoryId: transfer.materialCategoryId,
          batchId: batch.id,
          fromLocationId: transfer.sourceLocationId,
          toLocationId: transfer.sourceLocationId,
          quantityDeltaKg: transfer.quantityKg,
          reason: `Cancelled transfer ${transfer.referenceCode} — stock returned to available`,
          actorUserId: adminId,
        });
      }

      const [updated] = await tx
        .update(materialTransfers)
        .set({
          status: nextStatus,
          confirmedByAdminId: nextStatus === 'CONFIRMED' ? adminId : transfer.confirmedByAdminId,
          confirmedAt: nextStatus === 'CONFIRMED' ? now : transfer.confirmedAt,
          updatedAt: now,
        })
        .where(eq(materialTransfers.id, transferId))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: `MATERIAL_TRANSFER_${nextStatus}`,
        targetType: 'MATERIAL_TRANSFER',
        targetId: String(transferId),
        details: `${transfer.referenceCode} updated to ${nextStatus}`,
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in updateMaterialTransferStatusAdmin:', error);
    throw new Error('Could not update transfer status.', { cause: error });
  }
}

export async function listMaterialTransfersAdmin() {
  try {
    const [transfers, batches, cats, locs] = await Promise.all([
      db.select().from(materialTransfers).orderBy(desc(materialTransfers.createdAt)),
      db.select({ id: materialBatches.id, batchReference: materialBatches.batchReference }).from(materialBatches),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
      db.select({ id: storageLocations.id, name: storageLocations.name }).from(storageLocations),
    ]);
    const batchMap = new Map(batches.map((b) => [b.id, b.batchReference]));
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const locMap = new Map(locs.map((l) => [l.id, l.name]));

    return transfers.map((t) => ({
      ...t,
      batchReference: batchMap.get(t.batchId) ?? `#${t.batchId}`,
      materialName: catMap.get(t.materialCategoryId) ?? 'Unknown',
      sourceLocationName: locMap.get(t.sourceLocationId) ?? 'Unknown',
      destinationLocationName: locMap.get(t.destinationLocationId) ?? 'Unknown',
    }));
  } catch (error) {
    console.error('Database error in listMaterialTransfersAdmin:', error);
    throw new Error('Unable to load material transfers.', { cause: error });
  }
}

// ============================================================
// MATERIAL SALES / BUYER TRANSFERS (SEPARATE PAYMENT STATUS)
// ============================================================

export async function createMaterialSaleAdmin(
  adminId: number,
  input: {
    batchId: unknown;
    buyerName: unknown;
    buyerContact?: unknown;
    quantityKg: unknown;
    unitPriceNgn?: unknown;
    transferStatus?: unknown;
    paymentStatus?: unknown;
    documentationRef?: unknown;
    notes?: unknown;
  }
) {
  const batchId = Number(input.batchId);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    throw new ValidationError('Select a valid material batch.');
  }
  if (typeof input.buyerName !== 'string' || input.buyerName.trim().length < 2) {
    throw new ValidationError('Enter the recycling buyer or processor name.');
  }
  const buyerName = input.buyerName.trim().slice(0, 160);
  const buyerContact =
    typeof input.buyerContact === 'string' && input.buyerContact.trim()
      ? input.buyerContact.trim().slice(0, 160)
      : null;

  const qtyCg = parseCentigrams(input.quantityKg);
  if (qtyCg === null || qtyCg <= 0) {
    throw new ValidationError('Sale/transfer quantity must be greater than 0 kg.');
  }

  let unitPriceFormatted: string | null = null;
  let totalValueFormatted = '0.00';
  if (input.unitPriceNgn !== undefined && input.unitPriceNgn !== null && input.unitPriceNgn !== '') {
    const unitCents = parsePointsToCents(input.unitPriceNgn);
    if (unitCents === null || unitCents < 0n) {
      throw new ValidationError('Unit price must be 0 or a positive NGN amount.');
    }
    unitPriceFormatted = formatCentsToPoints(unitCents);
    const totalRaw = BigInt(qtyCg) * unitCents;
    totalValueFormatted = formatCentsToPoints((totalRaw + 50n) / 100n);
  }

  const validTransferStatuses = new Set<SaleTransferStatus>(['PENDING', 'PREPARED', 'TRANSFERRED']);
  const validPaymentStatuses = new Set<SalePaymentStatus>([
    'UNPAID',
    'PARTIALLY_PAID',
    'PAID',
    'FAILED',
    'NOT_APPLICABLE',
  ]);
  const transferStatus: SaleTransferStatus =
    typeof input.transferStatus === 'string' &&
    validTransferStatuses.has(input.transferStatus as SaleTransferStatus)
      ? (input.transferStatus as SaleTransferStatus)
      : 'PENDING';
  const paymentStatus: SalePaymentStatus =
    typeof input.paymentStatus === 'string' &&
    validPaymentStatuses.has(input.paymentStatus as SalePaymentStatus)
      ? (input.paymentStatus as SalePaymentStatus)
      : 'UNPAID';

  const documentationRef =
    typeof input.documentationRef === 'string' && input.documentationRef.trim()
      ? input.documentationRef.trim().slice(0, 160)
      : null;
  const notes =
    typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 600) : null;

  try {
    return await db.transaction(async (tx) => {
      const lock = await tx.execute(
        sql`SELECT id FROM material_batches WHERE id = ${batchId} FOR UPDATE`
      );
      if (!lock.rows.length) throw new NotFoundError('Material batch not found.');

      const [batch] = await tx
        .select()
        .from(materialBatches)
        .where(eq(materialBatches.id, batchId))
        .limit(1);

      const availCg = parseCentigrams(batch.availableWeightKg) ?? 0;
      if (qtyCg > availCg) {
        throw new ValidationError(
          `Overselling prevented: requested ${formatCentigramsToKg(
            qtyCg
          )} kg exceeds batch ${batch.batchReference} available weight (${batch.availableWeightKg} kg).`
        );
      }

      const qtyKg = formatCentigramsToKg(qtyCg);
      const remainingCg = availCg - qtyCg;
      const nextBatchStatus: BatchStatus =
        remainingCg === 0
          ? transferStatus === 'TRANSFERRED'
            ? 'SOLD'
            : 'READY_FOR_TRANSFER'
          : (batch.status as BatchStatus);

      const referenceCode = generateScopedReference('KSL');
      const [sale] = await tx
        .insert(materialSales)
        .values({
          referenceCode,
          batchId: batch.id,
          materialCategoryId: batch.materialCategoryId,
          buyerName,
          buyerContact,
          quantityKg: qtyKg,
          unitPriceNgn: unitPriceFormatted,
          totalValueNgn: totalValueFormatted,
          transferStatus,
          paymentStatus,
          documentationRef,
          notes,
          recordedByAdminId: adminId,
          isDemo: batch.isDemo,
        })
        .returning();

      await tx
        .update(materialBatches)
        .set({
          availableWeightKg: formatCentigramsToKg(remainingCg),
          status: nextBatchStatus,
          updatedAt: new Date(),
        })
        .where(eq(materialBatches.id, batch.id));

      await tx.insert(inventoryMovements).values({
        referenceCode: generateScopedReference('KMOV'),
        movementType: 'SALE',
        materialCategoryId: batch.materialCategoryId,
        batchId: batch.id,
        fromLocationId: batch.storageLocationId,
        quantityDeltaKg: `-${qtyKg}`,
        reason: `Sale/transfer ${referenceCode} to ${buyerName} (Transfer: ${transferStatus}, Payment: ${paymentStatus})`,
        actorUserId: adminId,
      });

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'MATERIAL_SALE_RECORDED',
        targetType: 'MATERIAL_SALE',
        targetId: String(sale.id),
        details: `${referenceCode} · ${batch.batchReference} · ${qtyKg} kg to ${buyerName} · NGN ${totalValueFormatted} · Transfer=${transferStatus} · Payment=${paymentStatus}`,
      });

      return sale;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in createMaterialSaleAdmin:', error);
    throw new Error('Could not record material sale.', { cause: error });
  }
}

export async function updateMaterialSaleStatusAdmin(
  saleId: number,
  adminId: number,
  input: {
    transferStatus?: unknown;
    paymentStatus?: unknown;
    documentationRef?: unknown;
    notes?: unknown;
  }
) {
  const validTransfer = new Set<SaleTransferStatus>([
    'PENDING',
    'PREPARED',
    'TRANSFERRED',
    'CANCELLED',
  ]);
  const validPayment = new Set<SalePaymentStatus>([
    'UNPAID',
    'PARTIALLY_PAID',
    'PAID',
    'FAILED',
    'NOT_APPLICABLE',
  ]);

  try {
    return await db.transaction(async (tx) => {
      const lock = await tx.execute(
        sql`SELECT id FROM material_sales WHERE id = ${saleId} FOR UPDATE`
      );
      if (!lock.rows.length) throw new NotFoundError('Material sale record not found.');

      const [sale] = await tx
        .select()
        .from(materialSales)
        .where(eq(materialSales.id, saleId))
        .limit(1);

      const nextTransfer: SaleTransferStatus =
        typeof input.transferStatus === 'string' &&
        validTransfer.has(input.transferStatus as SaleTransferStatus)
          ? (input.transferStatus as SaleTransferStatus)
          : (sale.transferStatus as SaleTransferStatus);

      const nextPayment: SalePaymentStatus =
        typeof input.paymentStatus === 'string' &&
        validPayment.has(input.paymentStatus as SalePaymentStatus)
          ? (input.paymentStatus as SalePaymentStatus)
          : (sale.paymentStatus as SalePaymentStatus);

      // If transitioning to CANCELLED from a non-cancelled state, return quantity to batch!
      if (nextTransfer === 'CANCELLED' && sale.transferStatus !== 'CANCELLED') {
        const [batch] = await tx
          .select()
          .from(materialBatches)
          .where(eq(materialBatches.id, sale.batchId))
          .limit(1);
        if (batch) {
          const restoredCg =
            (parseCentigrams(batch.availableWeightKg) ?? 0) +
            (parseCentigrams(sale.quantityKg) ?? 0);
          await tx
            .update(materialBatches)
            .set({
              availableWeightKg: formatCentigramsToKg(restoredCg),
              status: 'STORED',
              updatedAt: new Date(),
            })
            .where(eq(materialBatches.id, batch.id));

          await tx.insert(inventoryMovements).values({
            referenceCode: generateScopedReference('KMOV'),
            movementType: 'ADJUSTMENT',
            materialCategoryId: sale.materialCategoryId,
            batchId: batch.id,
            toLocationId: batch.storageLocationId,
            quantityDeltaKg: sale.quantityKg,
            reason: `Cancelled sale ${sale.referenceCode} — stock returned to batch`,
            actorUserId: adminId,
          });
        }
      }

      const [updated] = await tx
        .update(materialSales)
        .set({
          transferStatus: nextTransfer,
          paymentStatus: nextPayment,
          documentationRef:
            typeof input.documentationRef === 'string'
              ? input.documentationRef.trim().slice(0, 160) || null
              : sale.documentationRef,
          notes:
            typeof input.notes === 'string'
              ? input.notes.trim().slice(0, 600) || null
              : sale.notes,
          updatedAt: new Date(),
        })
        .where(eq(materialSales.id, saleId))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'MATERIAL_SALE_UPDATED',
        targetType: 'MATERIAL_SALE',
        targetId: String(saleId),
        details: `${sale.referenceCode} Transfer=${nextTransfer}, Payment=${nextPayment}`,
      });

      return updated;
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error;
    console.error('Database error in updateMaterialSaleStatusAdmin:', error);
    throw new Error('Could not update material sale record.', { cause: error });
  }
}

export async function listMaterialSalesAdmin() {
  try {
    const [sales, batches, cats] = await Promise.all([
      db.select().from(materialSales).orderBy(desc(materialSales.saleDate), desc(materialSales.id)),
      db.select({ id: materialBatches.id, batchReference: materialBatches.batchReference }).from(materialBatches),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
    ]);
    const batchMap = new Map(batches.map((b) => [b.id, b.batchReference]));
    const catMap = new Map(cats.map((c) => [c.id, c.name]));

    return sales.map((s) => ({
      ...s,
      batchReference: batchMap.get(s.batchId) ?? `#${s.batchId}`,
      materialName: catMap.get(s.materialCategoryId) ?? 'Unknown',
    }));
  } catch (error) {
    console.error('Database error in listMaterialSalesAdmin:', error);
    throw new Error('Unable to load material sales.', { cause: error });
  }
}

export async function listInventoryMovementsAdmin(limit = 120) {
  try {
    const [movements, cats, locs, batches] = await Promise.all([
      db
        .select()
        .from(inventoryMovements)
        .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
        .limit(limit),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
      db.select({ id: storageLocations.id, name: storageLocations.name }).from(storageLocations),
      db.select({ id: materialBatches.id, batchReference: materialBatches.batchReference }).from(materialBatches),
    ]);
    const catMap = new Map(cats.map((c) => [c.id, c.name]));
    const locMap = new Map(locs.map((l) => [l.id, l.name]));
    const batchMap = new Map(batches.map((b) => [b.id, b.batchReference]));

    return movements.map((m) => ({
      ...m,
      materialName: catMap.get(m.materialCategoryId) ?? 'Unknown',
      fromLocationName: m.fromLocationId ? locMap.get(m.fromLocationId) ?? null : null,
      toLocationName: m.toLocationId ? locMap.get(m.toLocationId) ?? null : null,
      batchReference: m.batchId ? batchMap.get(m.batchId) ?? null : null,
    }));
  } catch (error) {
    console.error('Database error in listInventoryMovementsAdmin:', error);
    throw new Error('Unable to load inventory movement history.', { cause: error });
  }
}

export async function getInventorySummaryAdmin() {
  try {
    const [entries, batches, transfers, sales, cats] = await Promise.all([
      db.select().from(inventoryEntries),
      db.select().from(materialBatches),
      db.select().from(materialTransfers),
      db.select().from(materialSales),
      db.select({ id: materialCategories.id, name: materialCategories.name }).from(materialCategories),
    ]);

    const byCategory = new Map<number, { name: string; unbatchedCg: number; batchedCg: number; soldCg: number }>();
    for (const c of cats) {
      byCategory.set(c.id, { name: c.name, unbatchedCg: 0, batchedCg: 0, soldCg: 0 });
    }

    let totalAvailableCg = 0;
    let totalReservedCg = 0;
    for (const e of entries) {
      const cg = parseCentigrams(e.availableWeightKg) ?? 0;
      totalAvailableCg += cg;
      const bucket = byCategory.get(e.materialCategoryId);
      if (bucket) bucket.unbatchedCg += cg;
    }
    for (const b of batches) {
      const availCg = parseCentigrams(b.availableWeightKg) ?? 0;
      const resCg = parseCentigrams(b.reservedWeightKg) ?? 0;
      totalAvailableCg += availCg;
      totalReservedCg += resCg;
      const bucket = byCategory.get(b.materialCategoryId);
      if (bucket) bucket.batchedCg += availCg;
    }

    let totalSoldCg = 0;
    let totalPaidValueCents = 0n;
    for (const s of sales) {
      if (s.transferStatus !== 'CANCELLED') {
        const cg = parseCentigrams(s.quantityKg) ?? 0;
        totalSoldCg += cg;
        const bucket = byCategory.get(s.materialCategoryId);
        if (bucket) bucket.soldCg += cg;
      }
      if (s.paymentStatus === 'PAID') {
        totalPaidValueCents += parseDecimalToScaledInt(s.totalValueNgn, 2) ?? 0n;
      }
    }

    return {
      totalAvailableKg: formatCentigramsToKg(totalAvailableCg),
      totalReservedKg: formatCentigramsToKg(totalReservedCg),
      totalSoldKg: formatCentigramsToKg(totalSoldCg),
      totalPaidSalesNgn: formatCentsToPoints(totalPaidValueCents),
      entryCount: entries.length,
      activeBatchCount: batches.filter((b) => b.status !== 'CLOSED' && b.status !== 'SOLD').length,
      totalBatchCount: batches.length,
      transferCount: transfers.length,
      saleCount: sales.length,
      categoryBreakdown: Array.from(byCategory.entries()).map(([id, b]) => ({
        materialCategoryId: id,
        materialName: b.name,
        unbatchedAvailableKg: formatCentigramsToKg(b.unbatchedCg),
        batchedAvailableKg: formatCentigramsToKg(b.batchedCg),
        soldKg: formatCentigramsToKg(b.soldCg),
      })),
    };
  } catch (error) {
    console.error('Database error in getInventorySummaryAdmin:', error);
    throw new Error('Unable to load inventory summary.', { cause: error });
  }
}
