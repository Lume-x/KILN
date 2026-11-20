import crypto from 'node:crypto';
import { and, asc, count, eq, gt, ne } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  collectionPoints,
  collectionRequests,
  materialCategories,
  notifications,
  partnershipInquiries,
  rewardWallets,
  userProfiles,
  userSessions,
  users,
  weightVerifications,
  type UserRole,
} from './schema.ts';
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  verifyPassword,
} from '../lib/security.ts';

export interface SafeUserContext {
  id: number;
  uid: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  role: UserRole;
  isActive: boolean;
  isDemo: boolean;
  communityArea: string;
  address: string | null;
  lightningAddress: string | null;
  nostrPubkey: string | null;
  unreadNotifications: number;
  createdAt: Date;
  wallet: {
    availablePoints: string;
    totalEarnedPoints: string;
    totalRedeemedPoints: string;
    pendingRedemptionPoints: string;
  };
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export async function getUserContextById(userId: number): Promise<SafeUserContext | null> {
  try {
    const rows = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        fullName: users.fullName,
        phoneNumber: users.phoneNumber,
        role: users.role,
        isActive: users.isActive,
        isDemo: users.isDemo,
        createdAt: users.createdAt,
        communityArea: userProfiles.communityArea,
        address: userProfiles.address,
        lightningAddress: userProfiles.lightningAddress,
        nostrPubkey: userProfiles.nostrPubkey,
        availablePoints: rewardWallets.availablePoints,
        totalEarnedPoints: rewardWallets.totalEarnedPoints,
        totalRedeemedPoints: rewardWallets.totalRedeemedPoints,
        pendingRedemptionPoints: rewardWallets.pendingRedemptionPoints,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(rewardWallets, eq(rewardWallets.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!rows.length) {
      return null;
    }

    const [unreadRow] = await db
      .select({ total: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));

    const row = rows[0];
    return {
      id: row.id,
      uid: row.uid,
      email: row.email,
      fullName: row.fullName,
      phoneNumber: row.phoneNumber,
      role: (row.role as UserRole) || 'USER',
      isActive: row.isActive,
      isDemo: row.isDemo,
      communityArea: row.communityArea ?? 'FUTO Campus',
      address: row.address ?? null,
      lightningAddress: row.lightningAddress ?? null,
      nostrPubkey: row.nostrPubkey ?? null,
      unreadNotifications: Number(unreadRow?.total ?? 0),
      createdAt: row.createdAt,
      wallet: {
        availablePoints: row.availablePoints ?? '0.00',
        totalEarnedPoints: row.totalEarnedPoints ?? '0.00',
        totalRedeemedPoints: row.totalRedeemedPoints ?? '0.00',
        pendingRedemptionPoints: row.pendingRedemptionPoints ?? '0.00',
      },
    };
  } catch (error) {
    console.error('Database query failed in getUserContextById:', error);
    throw new Error('Unable to load account details. Please try again.', { cause: error });
  }
}

export async function registerEmailUser(input: {
  fullName: string;
  email: string;
  phoneNumber?: string;
  password: string;
  communityArea: string;
}): Promise<SafeUserContext> {
  const email = normalizeEmail(input.email);

  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictError('An account with this email address already exists.');
    }

    const passwordHash = hashPassword(input.password);
    const uid = `kiln_${crypto.randomUUID()}`;

    const createdUserId = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({
          uid,
          email,
          passwordHash,
          fullName: input.fullName.trim(),
          phoneNumber: input.phoneNumber?.trim() || null,
          role: 'USER',
          isActive: true,
          isDemo: false,
          termsAcceptedAt: new Date(),
        })
        .returning({ id: users.id });

      await tx.insert(userProfiles).values({
        userId: newUser.id,
        communityArea: input.communityArea.trim() || 'FUTO Campus',
      });

      await tx.insert(rewardWallets).values({
        userId: newUser.id,
        availablePoints: '0.00',
        totalEarnedPoints: '0.00',
        totalRedeemedPoints: '0.00',
        pendingRedemptionPoints: '0.00',
      });

      await tx.insert(auditLogs).values({
        actorUserId: newUser.id,
        action: 'USER_REGISTERED',
        targetType: 'USER',
        targetId: String(newUser.id),
        details: `Self-registered participant in ${input.communityArea.trim() || 'FUTO Campus'}`,
      });

      return newUser.id;
    });

    const context = await getUserContextById(createdUserId);
    if (!context) {
      throw new Error('Account created but could not be loaded.');
    }
    return context;
  } catch (error) {
    if (error instanceof ConflictError) {
      throw error;
    }
    console.error('Database query failed in registerEmailUser:', error);
    throw new Error('Registration failed. Please try again later.', { cause: error });
  }
}

export async function authenticateEmailUser(
  emailInput: string,
  password: string
): Promise<SafeUserContext> {
  const email = normalizeEmail(emailInput);

  try {
    const rows = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!rows.length || !rows[0].passwordHash) {
      throw new AuthenticationError('Invalid email address or password.');
    }

    if (!rows[0].isActive) {
      throw new AuthenticationError('This account is currently inactive. Contact KILN support.');
    }

    const valid = verifyPassword(password, rows[0].passwordHash);
    if (!valid) {
      throw new AuthenticationError('Invalid email address or password.');
    }

    const context = await getUserContextById(rows[0].id);
    if (!context) {
      throw new AuthenticationError('Account record could not be found.');
    }
    return context;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    console.error('Database query failed in authenticateEmailUser:', error);
    throw new Error('Sign in failed. Please try again later.', { cause: error });
  }
}

export async function upsertFirebaseUser(input: {
  uid: string;
  email: string;
  fullName?: string;
}): Promise<SafeUserContext> {
  const email = normalizeEmail(input.email);
  const resolvedName = input.fullName?.trim() || email.split('@')[0] || 'KILN Participant';

  try {
    const existingByEmail = await db
      .select({ id: users.id, uid: users.uid, fullName: users.fullName })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let userId: number;

    if (existingByEmail.length > 0 && existingByEmail[0].uid !== input.uid) {
      const [updated] = await db
        .update(users)
        .set({
          uid: input.uid,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByEmail[0].id))
        .returning({ id: users.id });
      userId = updated.id;
    } else {
      const [upserted] = await db
        .insert(users)
        .values({
          uid: input.uid,
          email,
          fullName: resolvedName,
          role: 'USER',
          isActive: true,
          isDemo: false,
          termsAcceptedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email,
            updatedAt: new Date(),
          },
        })
        .returning({ id: users.id });
      userId = upserted.id;
    }

    await db
      .insert(userProfiles)
      .values({
        userId,
        communityArea: 'FUTO Campus',
      })
      .onConflictDoNothing({ target: userProfiles.userId });

    await db
      .insert(rewardWallets)
      .values({
        userId,
        availablePoints: '0.00',
        totalEarnedPoints: '0.00',
        totalRedeemedPoints: '0.00',
        pendingRedemptionPoints: '0.00',
      })
      .onConflictDoNothing({ target: rewardWallets.userId });

    const context = await getUserContextById(userId);
    if (!context) {
      throw new Error('Unable to load synchronized user account.');
    }
    return context;
  } catch (error) {
    console.error('Database query failed in upsertFirebaseUser:', error);
    throw new Error('Unable to complete Google sign-in right now.', { cause: error });
  }
}

export async function createUserSession(userId: number): Promise<string> {
  try {
    const { rawToken, tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.insert(userSessions).values({
      tokenHash,
      userId,
      expiresAt,
    });

    return rawToken;
  } catch (error) {
    console.error('Database query failed in createUserSession:', error);
    throw new Error('Unable to create session. Please try again.', { cause: error });
  }
}

export async function getUserBySessionToken(rawToken: string): Promise<SafeUserContext | null> {
  try {
    const tokenHash = hashSessionToken(rawToken);
    const now = new Date();
    const rows = await db
      .select({ userId: userSessions.userId })
      .from(userSessions)
      .where(and(eq(userSessions.tokenHash, tokenHash), gt(userSessions.expiresAt, now)))
      .limit(1);

    if (!rows.length) {
      return null;
    }

    return await getUserContextById(rows[0].userId);
  } catch (error) {
    console.error('Database query failed in getUserBySessionToken:', error);
    throw new Error('Session validation failed.', { cause: error });
  }
}

export async function deleteUserSession(rawToken: string): Promise<void> {
  try {
    const tokenHash = hashSessionToken(rawToken);
    await db.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash));
  } catch (error) {
    console.error('Database query failed in deleteUserSession:', error);
    throw new Error('Unable to end session cleanly.', { cause: error });
  }
}

export async function updateOwnUserProfile(
  userId: number,
  input: {
    fullName: string;
    phoneNumber?: string;
    communityArea: string;
    address?: string;
    lightningAddress?: string;
  }
): Promise<SafeUserContext> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          fullName: input.fullName.trim(),
          phoneNumber: input.phoneNumber?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      await tx
        .update(userProfiles)
        .set({
          communityArea: input.communityArea.trim() || 'FUTO Campus',
          address: input.address?.trim() || null,
          lightningAddress:
            input.lightningAddress !== undefined
              ? input.lightningAddress.trim() || null
              : undefined,
          updatedAt: new Date(),
        })
        .where(eq(userProfiles.userId, userId));

      await tx.insert(auditLogs).values({
        actorUserId: userId,
        action: 'PROFILE_UPDATED',
        targetType: 'USER',
        targetId: String(userId),
        details: 'Participant updated own profile details',
      });
    });

    const updated = await getUserContextById(userId);
    if (!updated) {
      throw new Error('Updated profile could not be loaded.');
    }
    return updated;
  } catch (error) {
    console.error('Database query failed in updateOwnUserProfile:', error);
    throw new Error('Could not save profile changes. Please try again.', { cause: error });
  }
}

export async function getPublicMaterialCategories() {
  try {
    return await db
      .select({
        id: materialCategories.id,
        name: materialCategories.name,
        slug: materialCategories.slug,
        description: materialCategories.description,
        imageUrl: materialCategories.imageUrl,
        unit: materialCategories.unit,
        rewardRateDemo: materialCategories.rewardRateDemo,
        isRateConfigured: materialCategories.isRateConfigured,
        acceptanceInfo: materialCategories.acceptanceInfo,
        preparationRequirements: materialCategories.preparationRequirements,
        contaminationRules: materialCategories.contaminationRules,
        streamType: materialCategories.streamType,
        displayOrder: materialCategories.displayOrder,
      })
      .from(materialCategories)
      .where(
        and(
          eq(materialCategories.streamType, 'RECYCLABLE'),
          eq(materialCategories.isActive, true)
        )
      )
      .orderBy(asc(materialCategories.displayOrder), asc(materialCategories.id));
  } catch (error) {
    console.error('Database query failed in getPublicMaterialCategories:', error);
    throw new Error('Unable to load accepted materials right now.', { cause: error });
  }
}

export async function getPublicCollectionPoints() {
  try {
    return await db
      .select({
        id: collectionPoints.id,
        name: collectionPoints.name,
        slug: collectionPoints.slug,
        address: collectionPoints.address,
        communityArea: collectionPoints.communityArea,
        description: collectionPoints.description,
        contactInfo: collectionPoints.contactInfo,
        operatingHours: collectionPoints.operatingHours,
        status: collectionPoints.status,
        isDemo: collectionPoints.isDemo,
      })
      .from(collectionPoints)
      .where(ne(collectionPoints.status, 'INACTIVE'))
      .orderBy(asc(collectionPoints.id));
  } catch (error) {
    console.error('Database query failed in getPublicCollectionPoints:', error);
    throw new Error('Unable to load pilot collection points right now.', { cause: error });
  }
}

export async function getPublicImpactSummary() {
  try {
    const [participantRow] = await db
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.isDemo, false), eq(users.role, 'USER')));

    const [materialRow] = await db
      .select({ total: count() })
      .from(materialCategories)
      .where(
        and(
          eq(materialCategories.streamType, 'RECYCLABLE'),
          eq(materialCategories.isActive, true)
        )
      );

    const verifiedRows = await db
      .select({
        verifiedEligibleWeightKg: weightVerifications.verifiedEligibleWeightKg,
      })
      .from(weightVerifications)
      .innerJoin(
        collectionRequests,
        eq(weightVerifications.collectionRequestId, collectionRequests.id)
      )
      .where(
        and(
          eq(weightVerifications.decision, 'APPROVED'),
          eq(collectionRequests.status, 'VERIFIED'),
          eq(collectionRequests.isDemo, false)
        )
      );

    let totalCentigrams = 0;
    for (const row of verifiedRows) {
      const [whole, frac = '00'] = String(row.verifiedEligibleWeightKg).split('.');
      totalCentigrams += Number(whole) * 100 + Number((frac + '00').slice(0, 2));
    }

    const verifiedKilograms = `${Math.floor(totalCentigrams / 100)}.${String(
      totalCentigrams % 100
    ).padStart(2, '0')}`;

    return {
      verifiedKilograms,
      verifiedCollections: verifiedRows.length,
      registeredParticipants: Number(participantRow?.total ?? 0),
      acceptedMaterialCategories: Number(materialRow?.total ?? 0),
      hasVerifiedCollections: verifiedRows.length > 0,
      pilotArea:
        'Federal University of Technology, Owerri (FUTO) & surrounding communities, Imo State, Nigeria',
    };
  } catch (error) {
    console.error('Database query failed in getPublicImpactSummary:', error);
    throw new Error('Unable to load community impact records right now.', { cause: error });
  }
}

export async function createPartnershipInquiry(input: {
  organizationName: string;
  contactName: string;
  email: string;
  phone?: string;
  partnerType: string;
  message: string;
}) {
  try {
    const [created] = await db
      .insert(partnershipInquiries)
      .values({
        organizationName: input.organizationName.trim(),
        contactName: input.contactName.trim(),
        email: normalizeEmail(input.email),
        phone: input.phone?.trim() || null,
        partnerType: input.partnerType,
        message: input.message.trim(),
        status: 'NEW',
      })
      .returning({
        id: partnershipInquiries.id,
        organizationName: partnershipInquiries.organizationName,
        partnerType: partnershipInquiries.partnerType,
        createdAt: partnershipInquiries.createdAt,
      });

    return created;
  } catch (error) {
    console.error('Database query failed in createPartnershipInquiry:', error);
    throw new Error('Unable to submit your inquiry right now. Please try again.', {
      cause: error,
    });
  }
}
