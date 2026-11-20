import crypto from 'node:crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  auditLogs,
  collectionRequests,
  integrationSettings,
  lightningPayments,
  materialCategories,
  nostrAuthChallenges,
  nostrPublications,
  redemptionRequests,
  userNwcConnections,
  userProfiles,
  wasteSubmissions,
  weightVerifications,
} from '../db/schema.ts';
import { encryptSecret, parseAndValidateNwcUri } from '../lib/crypto-vault.ts';
import { generateScopedReference } from '../lib/rewards-rules.ts';
import { NotFoundError, ValidationError } from '../db/collection-repository.ts';
import { transitionRedemptionStatusAdmin } from '../db/rewards-repository.ts';

// ============================================================
// STAGE 6: INTEGRATION CONFIGURATION (NO SECRET LEAKAGE)
// ============================================================

async function ensureIntegrationSettingsRow() {
  const [existing] = await db.select().from(integrationSettings).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(integrationSettings).values({}).returning();
  return created;
}

export async function getIntegrationSettingsSafe() {
  try {
    const row = await ensureIntegrationSettingsRow();
    let relays: string[] = ['wss://relay.damus.io', 'wss://nos.lol'];
    try {
      const parsed = JSON.parse(row.nostrRelayUrlsJson);
      if (Array.isArray(parsed)) {
        relays = parsed.filter((r): r is string => typeof r === 'string');
      }
    } catch {
      // default
    }

    // NEVER return nwcEncryptedSecret to any caller or frontend response!
    return {
      id: row.id,
      lightningEnabled: row.lightningEnabled,
      lightningMode: row.lightningMode as 'DISABLED' | 'DEMO' | 'NWC_LIVE',
      nwcConfigured: Boolean(row.nwcEncryptedSecret),
      nwcWalletPubkeyPreview: row.nwcWalletPubkeyPreview,
      nwcRelayHost: row.nwcRelayHost,
      nwcStatus: row.nwcStatus,
      nwcLastCheckedAt: row.nwcLastCheckedAt,
      nwcLastError: row.nwcLastError,
      nostrEnabled: row.nostrEnabled,
      nostrMode: row.nostrMode as 'DISABLED' | 'DEMO' | 'RELAY_LIVE',
      nostrRelayUrls: relays,
      nostrPublisherPubkey: row.nostrPublisherPubkey,
      nostrAutoPublish: row.nostrAutoPublish,
      aiSorterEnabled: row.aiSorterEnabled,
      aiProvider: row.aiProvider,
      geminiApiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      updatedAt: row.updatedAt,
    };
  } catch (error) {
    console.error('Database error in getIntegrationSettingsSafe:', error);
    throw new Error('Unable to load integration settings.', { cause: error });
  }
}

export async function updateIntegrationSettingsAdmin(
  adminId: number,
  input: {
    lightningEnabled?: unknown;
    lightningMode?: unknown;
    nwcUri?: unknown;
    disconnectNwc?: unknown;
    nostrEnabled?: unknown;
    nostrMode?: unknown;
    nostrRelayUrls?: unknown;
    nostrAutoPublish?: unknown;
    aiSorterEnabled?: unknown;
  }
) {
  const current = await ensureIntegrationSettingsRow();
  const updates: Partial<typeof integrationSettings.$inferInsert> = {
    updatedByAdminId: adminId,
    updatedAt: new Date(),
  };

  if (typeof input.lightningEnabled === 'boolean') {
    updates.lightningEnabled = input.lightningEnabled;
  }
  if (
    input.lightningMode === 'DISABLED' ||
    input.lightningMode === 'DEMO' ||
    input.lightningMode === 'NWC_LIVE'
  ) {
    updates.lightningMode = input.lightningMode;
  }

  if (input.disconnectNwc === true) {
    updates.nwcEncryptedSecret = null;
    updates.nwcWalletPubkeyPreview = null;
    updates.nwcRelayHost = null;
    updates.nwcStatus = 'DISCONNECTED';
    updates.nwcLastError = null;
    if ((updates.lightningMode ?? current.lightningMode) === 'NWC_LIVE') {
      updates.lightningMode = 'DEMO';
    }
  } else if (typeof input.nwcUri === 'string' && input.nwcUri.trim().length > 0) {
    const check = parseAndValidateNwcUri(input.nwcUri);
    if (!check.ok) {
      throw new ValidationError(check.error);
    }
    updates.nwcEncryptedSecret = encryptSecret(check.normalizedUri);
    updates.nwcWalletPubkeyPreview = check.value.walletPubkeyPreview;
    updates.nwcRelayHost = check.value.relayHost;
    updates.nwcStatus = 'CONFIGURED';
    updates.nwcLastCheckedAt = new Date();
    updates.nwcLastError = null;
  }

  if (typeof input.nostrEnabled === 'boolean') {
    updates.nostrEnabled = input.nostrEnabled;
  }
  if (
    input.nostrMode === 'DISABLED' ||
    input.nostrMode === 'DEMO' ||
    input.nostrMode === 'RELAY_LIVE'
  ) {
    updates.nostrMode = input.nostrMode;
  }
  if (typeof input.nostrAutoPublish === 'boolean') {
    updates.nostrAutoPublish = input.nostrAutoPublish;
  }
  if (Array.isArray(input.nostrRelayUrls)) {
    const cleanRelays = input.nostrRelayUrls
      .filter((r): r is string => typeof r === 'string')
      .map((r) => r.trim())
      .filter((r) => r.startsWith('wss://') || r.startsWith('ws://'))
      .slice(0, 8);
    if (cleanRelays.length === 0) {
      throw new ValidationError('Provide at least one valid wss:// Nostr relay URL.');
    }
    updates.nostrRelayUrlsJson = JSON.stringify(cleanRelays);
  }
  if (typeof input.aiSorterEnabled === 'boolean') {
    updates.aiSorterEnabled = input.aiSorterEnabled;
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(integrationSettings)
        .set(updates)
        .where(eq(integrationSettings.id, current.id));

      await tx.insert(auditLogs).values({
        actorUserId: adminId,
        action: 'INTEGRATION_SETTINGS_UPDATED',
        targetType: 'INTEGRATION_SETTINGS',
        targetId: String(current.id),
        details: `Lightning=${updates.lightningMode ?? current.lightningMode}, Nostr=${
          updates.nostrMode ?? current.nostrMode
        }, AI=${updates.aiSorterEnabled ?? current.aiSorterEnabled}${
          input.disconnectNwc ? ', NWC disconnected' : input.nwcUri ? ', NWC secret updated (masked)' : ''
        }`,
      });
    });

    return await getIntegrationSettingsSafe();
  } catch (error) {
    console.error('Database error in updateIntegrationSettingsAdmin:', error);
    throw new Error('Could not update integration settings.', { cause: error });
  }
}

// ============================================================
// USER OPTIONAL NWC WALLET CONNECTION (ENCRYPTED)
// ============================================================

export async function getUserNwcStatus(userId: number) {
  try {
    const [row] = await db
      .select({
        id: userNwcConnections.id,
        label: userNwcConnections.label,
        relayHost: userNwcConnections.relayHost,
        walletPubkeyPreview: userNwcConnections.walletPubkeyPreview,
        status: userNwcConnections.status,
        lastValidatedAt: userNwcConnections.lastValidatedAt,
        lastError: userNwcConnections.lastError,
        updatedAt: userNwcConnections.updatedAt,
      })
      .from(userNwcConnections)
      .where(eq(userNwcConnections.userId, userId))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('Database error in getUserNwcStatus:', error);
    throw new Error('Unable to load Lightning wallet connection status.', { cause: error });
  }
}

export async function connectUserNwc(
  userId: number,
  input: { nwcUri: unknown; label?: unknown }
) {
  const parsed = parseAndValidateNwcUri(input.nwcUri);
  if (!parsed.ok) {
    throw new ValidationError(parsed.error);
  }
  const label =
    typeof input.label === 'string' && input.label.trim().length > 0
      ? input.label.trim().slice(0, 60)
      : 'My Lightning Wallet';

  const encrypted = encryptSecret(parsed.normalizedUri);

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(userNwcConnections)
        .values({
          userId,
          label,
          encryptedUri: encrypted,
          relayHost: parsed.value.relayHost,
          walletPubkeyPreview: parsed.value.walletPubkeyPreview,
          status: 'CONNECTED',
          lastValidatedAt: new Date(),
          lastError: null,
        })
        .onConflictDoUpdate({
          target: userNwcConnections.userId,
          set: {
            label,
            encryptedUri: encrypted,
            relayHost: parsed.value.relayHost,
            walletPubkeyPreview: parsed.value.walletPubkeyPreview,
            status: 'CONNECTED',
            lastValidatedAt: new Date(),
            lastError: null,
            updatedAt: new Date(),
          },
        });

      // Audit log NEVER records the URI or secret!
      await tx.insert(auditLogs).values({
        actorUserId: userId,
        action: 'USER_NWC_CONNECTED',
        targetType: 'USER',
        targetId: String(userId),
        details: `Connected optional NWC wallet ${parsed.value.walletPubkeyPreview} via ${parsed.value.relayHost}`,
      });
    });

    return await getUserNwcStatus(userId);
  } catch (error) {
    console.error('Database error in connectUserNwc:', error);
    throw new Error('Could not save Lightning wallet connection.', { cause: error });
  }
}

export async function disconnectUserNwc(userId: number) {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(userNwcConnections).where(eq(userNwcConnections.userId, userId));
      await tx.insert(auditLogs).values({
        actorUserId: userId,
        action: 'USER_NWC_DISCONNECTED',
        targetType: 'USER',
        targetId: String(userId),
        details: 'Disconnected optional NWC wallet connection',
      });
    });
    return { disconnected: true };
  } catch (error) {
    console.error('Database error in disconnectUserNwc:', error);
    throw new Error('Could not disconnect NWC wallet.', { cause: error });
  }
}

// ============================================================
// LIGHTNING REDEMPTION PAYOUT WORKFLOW (IDEMPOTENT + DEMO SAFE)
// ============================================================

export async function executeLightningPayoutAdmin(
  redemptionId: number,
  adminId: number,
  options?: { simulateFailure?: boolean }
) {
  const settings = await ensureIntegrationSettingsRow();
  if (!settings.lightningEnabled || settings.lightningMode === 'DISABLED') {
    throw new ValidationError(
      'Bitcoin Lightning integration is currently disabled in Admin → Integrations.'
    );
  }

  const [redemption] = await db
    .select()
    .from(redemptionRequests)
    .where(eq(redemptionRequests.id, redemptionId))
    .limit(1);

  if (!redemption) throw new NotFoundError('Redemption request not found.');
  if (redemption.method !== 'BITCOIN_LIGHTNING') {
    throw new ValidationError('Only BITCOIN_LIGHTNING redemptions can be processed via Lightning.');
  }
  if (redemption.status !== 'APPROVED' && redemption.status !== 'PROCESSING') {
    throw new ValidationError(
      `Redemption must be APPROVED or PROCESSING before Lightning dispatch (current: ${redemption.status}).`
    );
  }

  // Idempotency guard: block duplicate Lightning payout execution
  const idempotencyKey = `ln_payout:redemption:${redemption.id}`;
  const [existingPaid] = await db
    .select()
    .from(lightningPayments)
    .where(
      and(
        eq(lightningPayments.redemptionRequestId, redemption.id),
        eq(lightningPayments.status, 'PAID')
      )
    )
    .limit(1);

  if (existingPaid) {
    throw new ValidationError(
      `A Lightning payout (${existingPaid.paymentReference}) has already been confirmed for ${redemption.referenceCode}.`
    );
  }

  const amountSats = Math.max(1, Math.round(Number(redemption.estimatedValueAmount) || 0));
  const mode = settings.lightningMode === 'NWC_LIVE' ? 'NWC_LIVE' : 'DEMO_SIMULATED';

  if (mode === 'NWC_LIVE' && !settings.nwcEncryptedSecret) {
    throw new ValidationError(
      'Lightning mode is set to NWC_LIVE, but no platform NWC wallet URI is configured.'
    );
  }

  // Move to PROCESSING first if APPROVED
  if (redemption.status === 'APPROVED') {
    await transitionRedemptionStatusAdmin(redemption.id, adminId, {
      nextStatus: 'PROCESSING',
      note:
        mode === 'DEMO_SIMULATED'
          ? 'Initiated SIMULATED Lightning payout workflow (Demo Mode).'
          : 'Initiated NWC Lightning payout request.',
    });
  }

  // Handle explicit failure test OR NWC_LIVE without reachable live relay
  if (options?.simulateFailure || mode === 'NWC_LIVE') {
    const failureReason = options?.simulateFailure
      ? 'Simulated Lightning routing failure (Demo Test) — reserved points automatically refunded.'
      : 'Live NWC relay settlement requires an active NIP-47 WebSocket relay transport; redemption was NOT marked paid and reserved points were refunded.';

    const [failedPayment] = await db
      .insert(lightningPayments)
      .values({
        redemptionRequestId: redemption.id,
        idempotencyKey: `${idempotencyKey}:fail:${Date.now()}`,
        mode,
        destination: redemption.destinationSummary,
        amountSats,
        status: 'FAILED',
        paymentReference: null,
        providerResponseSummary:
          mode === 'DEMO_SIMULATED' ? 'SIMULATED FAILURE' : 'NWC LIVE TRANSPORT UNAVAILABLE',
        errorMessage: failureReason,
        initiatedByAdminId: adminId,
        isSimulated: mode === 'DEMO_SIMULATED',
      })
      .returning();

    const updatedRedemption = await transitionRedemptionStatusAdmin(redemption.id, adminId, {
      nextStatus: 'FAILED',
      note: failureReason,
    });

    return { payment: failedPayment, redemption: updatedRedemption };
  }

  // DEMO_SIMULATED mode: clearly labelled SIMULATED PAYMENT, NEVER a fake preimage
  const simReference = generateScopedReference('SIM-LN');

  const [payment] = await db
    .insert(lightningPayments)
    .values({
      redemptionRequestId: redemption.id,
      idempotencyKey,
      mode: 'DEMO_SIMULATED',
      destination: redemption.destinationSummary,
      amountSats,
      status: 'PAID',
      paymentReference: simReference,
      providerResponseSummary:
        'SIMULATED PAYMENT (DEMO MODE) — No real Bitcoin or satoshis were transmitted.',
      initiatedByAdminId: adminId,
      isSimulated: true,
    })
    .returning();

  const updatedRedemption = await transitionRedemptionStatusAdmin(redemption.id, adminId, {
    nextStatus: 'PAID',
    payoutReference: `${simReference} (SIMULATED DEMO)`,
    note: 'Completed via clearly labelled SIMULATED Lightning payout workflow (Demo Mode — no real funds sent).',
  });

  return { payment, redemption: updatedRedemption };
}

export async function listLightningPaymentsAdmin() {
  try {
    const payments = await db
      .select()
      .from(lightningPayments)
      .orderBy(desc(lightningPayments.createdAt), desc(lightningPayments.id))
      .limit(100);

    const reqRows = await db
      .select({
        id: redemptionRequests.id,
        referenceCode: redemptionRequests.referenceCode,
        status: redemptionRequests.status,
      })
      .from(redemptionRequests);
    const reqMap = new Map(reqRows.map((r) => [r.id, r]));

    return payments.map((p) => ({
      ...p,
      redemptionReference: reqMap.get(p.redemptionRequestId)?.referenceCode ?? `#${p.redemptionRequestId}`,
      redemptionStatus: reqMap.get(p.redemptionRequestId)?.status ?? 'UNKNOWN',
    }));
  } catch (error) {
    console.error('Database error in listLightningPaymentsAdmin:', error);
    throw new Error('Unable to load Lightning payment reconciliation records.', { cause: error });
  }
}

// ============================================================
// OPTIONAL NOSTR IDENTITY CHALLENGE-SIGNING FOUNDATION
// ============================================================

export async function createNostrChallenge(userId: number) {
  const nonce = `kiln-nostr-verify-${crypto.randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  try {
    const [row] = await db
      .insert(nostrAuthChallenges)
      .values({ userId, challengeNonce: nonce, expiresAt })
      .returning();
    return {
      challengeNonce: row.challengeNonce,
      expiresAt: row.expiresAt,
      kind: 27235,
      message: `Verify KILN Nostr identity ownership: ${row.challengeNonce}`,
    };
  } catch (error) {
    console.error('Database error in createNostrChallenge:', error);
    throw new Error('Could not generate Nostr identity challenge.', { cause: error });
  }
}

export async function bindUserNostrPubkey(
  userId: number,
  input: {
    pubkeyHex: unknown;
    challengeNonce?: unknown;
    signedEventId?: unknown;
  }
) {
  if (typeof input.pubkeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(input.pubkeyHex.trim())) {
    throw new ValidationError(
      'Enter a valid 64-character hexadecimal Nostr public key (never enter an nsec private key).'
    );
  }
  const pubkey = input.pubkeyHex.trim().toLowerCase();

  try {
    return await db.transaction(async (tx) => {
      if (typeof input.challengeNonce === 'string' && input.challengeNonce.trim()) {
        const [challenge] = await tx
          .select()
          .from(nostrAuthChallenges)
          .where(
            and(
              eq(nostrAuthChallenges.challengeNonce, input.challengeNonce.trim()),
              eq(nostrAuthChallenges.userId, userId),
              isNull(nostrAuthChallenges.usedAt),
              gt(nostrAuthChallenges.expiresAt, new Date())
            )
          )
          .limit(1);

        if (!challenge) {
          throw new ValidationError('Nostr challenge nonce is expired or already used.');
        }

        await tx
          .update(nostrAuthChallenges)
          .set({ usedAt: new Date() })
          .where(eq(nostrAuthChallenges.id, challenge.id));
      }

      await tx
        .update(userProfiles)
        .set({ nostrPubkey: pubkey, updatedAt: new Date() })
        .where(eq(userProfiles.userId, userId));

      await tx.insert(auditLogs).values({
        actorUserId: userId,
        action: 'NOSTR_IDENTITY_LINKED',
        targetType: 'USER',
        targetId: String(userId),
        details: `Linked public Nostr identity ${pubkey.slice(0, 12)}...`,
      });

      return { nostrPubkey: pubkey };
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    console.error('Database error in bindUserNostrPubkey:', error);
    throw new Error('Could not link Nostr public identity.', { cause: error });
  }
}

export async function unlinkUserNostrPubkey(userId: number) {
  try {
    await db
      .update(userProfiles)
      .set({ nostrPubkey: null, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId));
    return { unlinked: true };
  } catch (error) {
    console.error('Database error in unlinkUserNostrPubkey:', error);
    throw new Error('Could not remove Nostr identity.', { cause: error });
  }
}

// ============================================================
// PRIVACY-PRESERVING NOSTR PROOF-OF-RECYCLING PUBLISHER
// ============================================================

export function buildPrivacySafeNostrPayload(params: {
  pilotHub: string;
  materialCategoryName: string;
  verifiedWeightKg: string;
  referenceCode: string;
  verifiedAt: Date;
  isDemo: boolean;
}) {
  const prefix = params.isDemo ? 'KILN [DEMO]' : 'KILN';
  return `${prefix} | ${params.pilotHub} | ${params.materialCategoryName} | ${
    params.verifiedWeightKg
  } kg | Ref ${params.referenceCode} | ${params.verifiedAt.toISOString()}`;
}

export async function publishProofOfRecyclingAdmin(
  verificationId: number,
  adminId: number,
  options?: { simulateFailure?: boolean }
) {
  const settings = await ensureIntegrationSettingsRow();
  if (!settings.nostrEnabled || settings.nostrMode === 'DISABLED') {
    throw new ValidationError('Nostr Proof-of-Recycling publishing is currently disabled.');
  }

  const [ver] = await db
    .select()
    .from(weightVerifications)
    .where(eq(weightVerifications.id, verificationId))
    .limit(1);

  if (!ver) throw new NotFoundError('Weight verification record not found.');
  if (ver.decision !== 'APPROVED') {
    throw new ValidationError('Only APPROVED weight verifications may be published as Proof-of-Recycling.');
  }

  const [existingPub] = await db
    .select()
    .from(nostrPublications)
    .where(eq(nostrPublications.verificationId, verificationId))
    .limit(1);

  if (existingPub && (existingPub.status === 'PUBLISHED' || existingPub.status === 'SIMULATED')) {
    throw new ValidationError(
      `Verification #${verificationId} has already been published (${existingPub.eventId}).`
    );
  }

  const [reqRow] = await db
    .select()
    .from(collectionRequests)
    .where(eq(collectionRequests.id, ver.collectionRequestId))
    .limit(1);

  const [subRow] = await db
    .select()
    .from(wasteSubmissions)
    .where(eq(wasteSubmissions.id, ver.submissionId))
    .limit(1);

  const [cat] = await db
    .select({ name: materialCategories.name })
    .from(materialCategories)
    .where(eq(materialCategories.id, subRow?.materialCategoryId ?? reqRow.materialCategoryId))
    .limit(1);

  const isDemoRecord = Boolean(reqRow?.isDemo) || settings.nostrMode === 'DEMO';
  const pilotHub = 'FUTO-Owerri';
  const materialName = cat?.name ?? 'Recyclable Material';

  // STRICT PRIVACY CHECK: Payload contains zero names, emails, phones, addresses, notes, or photos!
  const payloadContent = buildPrivacySafeNostrPayload({
    pilotHub,
    materialCategoryName: materialName,
    verifiedWeightKg: ver.verifiedEligibleWeightKg,
    referenceCode: reqRow?.referenceCode ?? `VER-${ver.id}`,
    verifiedAt: ver.verifiedAt,
    isDemo: isDemoRecord,
  });

  const mode = isDemoRecord ? 'DEMO_SIMULATED' : 'RELAY_LIVE';
  const shouldFail = Boolean(options?.simulateFailure) || mode === 'RELAY_LIVE';
  const now = new Date();
  const status = shouldFail ? 'FAILED' : 'SIMULATED';
  const eventId = shouldFail
    ? null
    : `sim_nostr_${crypto.createHash('sha256').update(`${ver.id}:${payloadContent}`).digest('hex').slice(0, 24)}`;
  const lastError = shouldFail
    ? options?.simulateFailure
      ? 'Simulated relay timeout (test mode) — safe to retry.'
      : 'Live Nostr relay signing key (NOSTR_PRIVATE_KEY) is not configured on this server; event saved as FAILED for safe retry.'
    : null;

  try {
    let saved;
    if (existingPub) {
      [saved] = await db
        .update(nostrPublications)
        .set({
          mode,
          payloadContent,
          eventId,
          relaysTargetedJson: settings.nostrRelayUrlsJson,
          status,
          retryCount: existingPub.retryCount + 1,
          lastError,
          isDemo: isDemoRecord,
          publishedAt: shouldFail ? null : now,
          updatedAt: now,
        })
        .where(eq(nostrPublications.id, existingPub.id))
        .returning();
    } else {
      [saved] = await db
        .insert(nostrPublications)
        .values({
          verificationId: ver.id,
          collectionRequestId: ver.collectionRequestId,
          mode,
          pilotHub,
          materialCategoryName: materialName,
          verifiedWeightKg: ver.verifiedEligibleWeightKg,
          payloadContent,
          eventId,
          relaysTargetedJson: settings.nostrRelayUrlsJson,
          status,
          retryCount: 0,
          lastError,
          isDemo: isDemoRecord,
          publishedAt: shouldFail ? null : now,
        })
        .returning();
    }

    await db.insert(auditLogs).values({
      actorUserId: adminId,
      action: shouldFail ? 'NOSTR_PUBLICATION_FAILED' : 'NOSTR_PROOF_PUBLISHED',
      targetType: 'NOSTR_PUBLICATION',
      targetId: String(saved.id),
      details: `${status} (${mode}) · ${payloadContent}`,
    });

    return saved;
  } catch (error) {
    console.error('Database error in publishProofOfRecyclingAdmin:', error);
    throw new Error('Could not process Proof-of-Recycling publication.', { cause: error });
  }
}

export async function listNostrPublicationsAdmin() {
  try {
    const [pubs, approvedVerifications] = await Promise.all([
      db
        .select()
        .from(nostrPublications)
        .orderBy(desc(nostrPublications.createdAt), desc(nostrPublications.id))
        .limit(100),
      db
        .select({
          verificationId: weightVerifications.id,
          collectionRequestId: weightVerifications.collectionRequestId,
          verifiedEligibleWeightKg: weightVerifications.verifiedEligibleWeightKg,
          verifiedAt: weightVerifications.verifiedAt,
          referenceCode: collectionRequests.referenceCode,
          isDemo: collectionRequests.isDemo,
          materialName: materialCategories.name,
        })
        .from(weightVerifications)
        .innerJoin(
          collectionRequests,
          eq(weightVerifications.collectionRequestId, collectionRequests.id)
        )
        .innerJoin(
          materialCategories,
          eq(collectionRequests.materialCategoryId, materialCategories.id)
        )
        .where(eq(weightVerifications.decision, 'APPROVED'))
        .orderBy(desc(weightVerifications.verifiedAt))
        .limit(50),
    ]);

    const publishedIds = new Set(
      pubs
        .filter((p) => p.status === 'PUBLISHED' || p.status === 'SIMULATED')
        .map((p) => p.verificationId)
    );

    return {
      publications: pubs,
      eligibleUnpublished: approvedVerifications.filter((v) => !publishedIds.has(v.verificationId)),
    };
  } catch (error) {
    console.error('Database error in listNostrPublicationsAdmin:', error);
    throw new Error('Unable to load Nostr Proof-of-Recycling records.', { cause: error });
  }
}
