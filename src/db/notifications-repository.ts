import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  notificationPreferences,
  notifications,
  users,
  type NotificationEventType,
} from './schema.ts';

type DbExecutor = Pick<typeof db, 'insert' | 'select' | 'update'>;

export interface CreateNotificationInput {
  userId: number;
  eventType: NotificationEventType;
  title: string;
  message: string;
  actionRoute?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
}

function getPreferenceCategory(
  eventType: NotificationEventType
): 'collection' | 'verification' | 'redemption' | 'learning' | 'always' {
  switch (eventType) {
    case 'COLLECTION_SUBMITTED':
    case 'COLLECTION_APPROVED':
    case 'COLLECTION_REJECTED':
    case 'AGENT_ASSIGNED':
    case 'AGENT_ACCEPTED':
    case 'AGENT_REJECTED':
    case 'COLLECTION_IN_PROGRESS':
    case 'COLLECTION_COMPLETED':
      return 'collection';
    case 'VERIFICATION_APPROVED':
    case 'VERIFICATION_REJECTED':
    case 'REWARD_CREDITED':
    case 'ADMIN_ADJUSTMENT':
      return 'verification';
    case 'REDEMPTION_SUBMITTED':
    case 'REDEMPTION_APPROVED':
    case 'REDEMPTION_REJECTED':
    case 'REDEMPTION_PROCESSED':
    case 'REDEMPTION_FAILED':
    case 'REDEMPTION_CANCELLED':
      return 'redemption';
    case 'LEARNING_COMPLETED':
      return 'learning';
    default:
      return 'always';
  }
}

export async function createNotificationTx(
  executor: DbExecutor,
  input: CreateNotificationInput
): Promise<void> {
  const category = getPreferenceCategory(input.eventType);
  if (category !== 'always') {
    const [prefs] = await executor
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, input.userId))
      .limit(1);

    if (prefs) {
      if (category === 'collection' && !prefs.collectionUpdates) return;
      if (category === 'verification' && !prefs.verificationRewards) return;
      if (category === 'redemption' && !prefs.redemptionUpdates) return;
      if (category === 'learning' && !prefs.learningUpdates) return;
    }
  }

  await executor.insert(notifications).values({
    userId: input.userId,
    eventType: input.eventType,
    title: input.title,
    message: input.message,
    actionRoute: input.actionRoute ?? null,
    relatedType: input.relatedType ?? null,
    relatedId: input.relatedId ?? null,
    isRead: false,
  });
}

export async function notifyActiveAdminsTx(
  executor: DbExecutor,
  input: Omit<CreateNotificationInput, 'userId'>
): Promise<void> {
  const admins = await executor
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)));

  for (const admin of admins) {
    await executor.insert(notifications).values({
      userId: admin.id,
      eventType: input.eventType,
      title: input.title,
      message: input.message,
      actionRoute: input.actionRoute ?? '/admin',
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      isRead: false,
    });
  }
}

export async function listUserNotifications(userId: number, unreadOnly = false) {
  try {
    const conditions = [eq(notifications.userId, userId)];
    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }
    const items = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(100);

    const unreadCount = items.filter((n) => !n.isRead).length;
    return { notifications: items, unreadCount };
  } catch (error) {
    console.error('Database error in listUserNotifications:', error);
    throw new Error('Unable to load notifications right now.', { cause: error });
  }
}

export async function markNotificationRead(userId: number, notificationId: number) {
  try {
    const [updated] = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('Database error in markNotificationRead:', error);
    throw new Error('Unable to update notification status.', { cause: error });
  }
}

export async function markAllNotificationsRead(userId: number) {
  try {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return { ok: true };
  } catch (error) {
    console.error('Database error in markAllNotificationsRead:', error);
    throw new Error('Unable to mark notifications as read.', { cause: error });
  }
}

export async function getUserNotificationPreferences(userId: number) {
  try {
    const [existing] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);

    if (existing) return existing;

    const [created] = await db
      .insert(notificationPreferences)
      .values({ userId })
      .onConflictDoNothing({ target: notificationPreferences.userId })
      .returning();

    if (created) return created;

    const [reloaded] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    return reloaded;
  } catch (error) {
    console.error('Database error in getUserNotificationPreferences:', error);
    throw new Error('Unable to load notification preferences.', { cause: error });
  }
}

export async function updateUserNotificationPreferences(
  userId: number,
  input: {
    collectionUpdates?: boolean;
    verificationRewards?: boolean;
    redemptionUpdates?: boolean;
    learningUpdates?: boolean;
  }
) {
  try {
    const current = await getUserNotificationPreferences(userId);
    const [updated] = await db
      .update(notificationPreferences)
      .set({
        collectionUpdates:
          typeof input.collectionUpdates === 'boolean'
            ? input.collectionUpdates
            : current.collectionUpdates,
        verificationRewards:
          typeof input.verificationRewards === 'boolean'
            ? input.verificationRewards
            : current.verificationRewards,
        redemptionUpdates:
          typeof input.redemptionUpdates === 'boolean'
            ? input.redemptionUpdates
            : current.redemptionUpdates,
        learningUpdates:
          typeof input.learningUpdates === 'boolean'
            ? input.learningUpdates
            : current.learningUpdates,
        updatedAt: new Date(),
      })
      .where(eq(notificationPreferences.userId, userId))
      .returning();

    return updated;
  } catch (error) {
    console.error('Database error in updateUserNotificationPreferences:', error);
    throw new Error('Unable to save notification preferences.', { cause: error });
  }
}
