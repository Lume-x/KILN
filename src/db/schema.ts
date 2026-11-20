import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const USER_ROLES = ['USER', 'AGENT', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MATERIAL_STREAM_TYPES = ['RECYCLABLE', 'ORGANIC_W2E', 'RESIDUAL'] as const;
export type MaterialStreamType = (typeof MATERIAL_STREAM_TYPES)[number];

export const COLLECTION_POINT_STATUSES = ['ACTIVE', 'DEMO', 'PLANNED', 'INACTIVE'] as const;
export type CollectionPointStatus = (typeof COLLECTION_POINT_STATUSES)[number];

export const COLLECTION_METHODS = ['PICKUP', 'DROP_OFF'] as const;
export type CollectionMethod = (typeof COLLECTION_METHODS)[number];

export const COLLECTION_REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'ASSIGNED',
  'ACCEPTED_BY_AGENT',
  'IN_PROGRESS',
  'COLLECTED',
  'AWAITING_VERIFICATION',
  'VERIFIED',
  'REJECTED',
  'CANCELLED',
] as const;
export type CollectionRequestStatus = (typeof COLLECTION_REQUEST_STATUSES)[number];

export const ASSIGNMENT_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const QUALITY_GRADES = ['A_CLEAN', 'B_STANDARD', 'C_MIXED', 'REJECTED'] as const;
export type QualityGrade = (typeof QUALITY_GRADES)[number];

export const VERIFICATION_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

export const LEDGER_TRANSACTION_TYPES = [
  'COLLECTION_REWARD',
  'LEARNING_BONUS',
  'REDEMPTION',
  'ADMIN_ADJUSTMENT',
  'REVERSAL',
] as const;
export type LedgerTransactionType = (typeof LEDGER_TRANSACTION_TYPES)[number];

export const LEDGER_DIRECTIONS = ['CREDIT', 'DEBIT'] as const;
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

export const REDEMPTION_METHODS = [
  'BITCOIN_LIGHTNING',
  'BANK_TRANSFER',
  'AIRTIME',
  'MOBILE_DATA',
  'CAMPUS_VOUCHER',
] as const;
export type RedemptionMethod = (typeof REDEMPTION_METHODS)[number];

export const REDEMPTION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'PAID',
  'FAILED',
  'CANCELLED',
] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

export const NOTIFICATION_EVENT_TYPES = [
  'COLLECTION_SUBMITTED',
  'COLLECTION_APPROVED',
  'COLLECTION_REJECTED',
  'AGENT_ASSIGNED',
  'AGENT_ACCEPTED',
  'AGENT_REJECTED',
  'COLLECTION_IN_PROGRESS',
  'COLLECTION_COMPLETED',
  'VERIFICATION_APPROVED',
  'VERIFICATION_REJECTED',
  'REWARD_CREDITED',
  'REDEMPTION_SUBMITTED',
  'REDEMPTION_APPROVED',
  'REDEMPTION_REJECTED',
  'REDEMPTION_PROCESSED',
  'REDEMPTION_FAILED',
  'REDEMPTION_CANCELLED',
  'LEARNING_COMPLETED',
  'ADMIN_PENDING_VERIFICATION',
  'ADMIN_PENDING_REDEMPTION',
  'ADMIN_ADJUSTMENT',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const INVENTORY_STATUSES = [
  'RECEIVED',
  'SORTED',
  'STORED',
  'BATCHED',
  'SOLD',
  'TRANSFERRED',
  'REJECTED',
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const BATCH_STATUSES = [
  'OPEN',
  'STORED',
  'READY_FOR_TRANSFER',
  'TRANSFERRED',
  'SOLD',
  'CLOSED',
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const MOVEMENT_TYPES = [
  'RECEIPT',
  'CONSOLIDATION',
  'LOCATION_TRANSFER',
  'RESERVATION',
  'DISPATCH',
  'SALE',
  'ADJUSTMENT',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const TRANSFER_STATUSES = ['PENDING', 'IN_TRANSIT', 'CONFIRMED', 'CANCELLED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const SALE_TRANSFER_STATUSES = ['PENDING', 'PREPARED', 'TRANSFERRED', 'CANCELLED'] as const;
export type SaleTransferStatus = (typeof SALE_TRANSFER_STATUSES)[number];

export const SALE_PAYMENT_STATUSES = [
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'FAILED',
  'NOT_APPLICABLE',
] as const;
export type SalePaymentStatus = (typeof SALE_PAYMENT_STATUSES)[number];

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    fullName: text('full_name').notNull(),
    phoneNumber: text('phone_number'),
    role: text('role').notNull().default('USER'),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    termsAcceptedAt: timestamp('terms_accepted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('users_role_idx').on(table.role)]
);

export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  communityArea: text('community_area').notNull().default('FUTO Campus'),
  address: text('address'),
  lightningAddress: text('lightning_address'),
  nostrPubkey: text('nostr_pubkey'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const collectionAgentProfiles = pgTable('collection_agent_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  serviceZone: text('service_zone').notNull().default('FUTO & Ihiagwa'),
  isAvailable: boolean('is_available').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const rewardWallets = pgTable('reward_wallets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  availablePoints: numeric('available_points', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  totalEarnedPoints: numeric('total_earned_points', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  totalRedeemedPoints: numeric('total_redeemed_points', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  pendingRedemptionPoints: numeric('pending_redemption_points', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSessions = pgTable(
  'user_sessions',
  {
    id: serial('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('user_sessions_user_id_idx').on(table.userId)]
);

export const materialCategories = pgTable(
  'material_categories',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull().unique(),
    slug: text('slug').notNull().unique(),
    description: text('description').notNull(),
    imageUrl: text('image_url').notNull(),
    unit: text('unit').notNull().default('kg'),
    rewardRateDemo: numeric('reward_rate_demo', { precision: 10, scale: 2 }),
    isRateConfigured: boolean('is_rate_configured').notNull().default(false),
    acceptanceInfo: text('acceptance_info').notNull(),
    preparationRequirements: text('preparation_requirements').notNull(),
    contaminationRules: text('contamination_rules').notNull(),
    streamType: text('stream_type').notNull().default('RECYCLABLE'),
    isActive: boolean('is_active').notNull().default(true),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('material_categories_stream_active_idx').on(table.streamType, table.isActive)]
);

export const collectionPoints = pgTable('collection_points', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  address: text('address').notNull(),
  communityArea: text('community_area').notNull(),
  description: text('description').notNull(),
  contactInfo: text('contact_info'),
  operatingHours: text('operating_hours').notNull(),
  status: text('status').notNull().default('PLANNED'),
  isDemo: boolean('is_demo').notNull().default(true),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Stage 3: Collection Workflow Tables
export const collectionRequests = pgTable(
  'collection_requests',
  {
    id: serial('id').primaryKey(),
    referenceCode: text('reference_code').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    materialCategoryId: integer('material_category_id')
      .references(() => materialCategories.id, { onDelete: 'restrict' })
      .notNull(),
    estimatedWeightKg: numeric('estimated_weight_kg', { precision: 10, scale: 2 }).notNull(),
    collectionMethod: text('collection_method').notNull(), // PICKUP | DROP_OFF
    collectionPointId: integer('collection_point_id').references(() => collectionPoints.id, {
      onDelete: 'set null',
    }),
    pickupAddress: text('pickup_address'),
    communityArea: text('community_area').notNull(),
    landmarksDirections: text('landmarks_directions'),
    preferredWindow: text('preferred_window').notNull(),
    notes: text('notes'),
    photoDataUrl: text('photo_data_url'),
    aiClassificationJson: text('ai_classification_json'),
    status: text('status').notNull().default('PENDING'),
    statusReason: text('status_reason'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('collection_requests_user_idx').on(table.userId),
    index('collection_requests_status_idx').on(table.status),
    index('collection_requests_category_idx').on(table.materialCategoryId),
  ]
);

export const collectionAssignments = pgTable(
  'collection_assignments',
  {
    id: serial('id').primaryKey(),
    collectionRequestId: integer('collection_request_id')
      .references(() => collectionRequests.id, { onDelete: 'cascade' })
      .notNull(),
    agentUserId: integer('agent_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    assignedByUserId: integer('assigned_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | ACCEPTED | REJECTED | COMPLETED | CANCELLED
    agentResponseNote: text('agent_response_note'),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    respondedAt: timestamp('responded_at'),
    startedAt: timestamp('started_at'),
    collectedAt: timestamp('collected_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('collection_assignments_request_idx').on(table.collectionRequestId),
    index('collection_assignments_agent_idx').on(table.agentUserId, table.status),
  ]
);

export const wasteSubmissions = pgTable(
  'waste_submissions',
  {
    id: serial('id').primaryKey(),
    collectionRequestId: integer('collection_request_id')
      .references(() => collectionRequests.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    assignmentId: integer('assignment_id')
      .references(() => collectionAssignments.id, { onDelete: 'restrict' })
      .notNull(),
    recordedByAgentId: integer('recorded_by_agent_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    materialCategoryId: integer('material_category_id')
      .references(() => materialCategories.id, { onDelete: 'restrict' })
      .notNull(),
    actualWeightKg: numeric('actual_weight_kg', { precision: 10, scale: 2 }).notNull(),
    rejectedWeightKg: numeric('rejected_weight_kg', { precision: 10, scale: 2 })
      .notNull()
      .default('0.00'),
    eligibleWeightKg: numeric('eligible_weight_kg', { precision: 10, scale: 2 }).notNull(),
    qualityGrade: text('quality_grade').notNull(),
    contaminationNotes: text('contamination_notes'),
    agentNotes: text('agent_notes'),
    evidencePhotoUrl: text('evidence_photo_url'),
    collectedAt: timestamp('collected_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('waste_submissions_agent_idx').on(table.recordedByAgentId)]
);

// Stage 4: Material Reward Rates (immutable history per material)
export const rewardRates = pgTable(
  'reward_rates',
  {
    id: serial('id').primaryKey(),
    materialCategoryId: integer('material_category_id')
      .references(() => materialCategories.id, { onDelete: 'restrict' })
      .notNull(),
    pointsPerKg: numeric('points_per_kg', { precision: 10, scale: 2 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: boolean('is_demo').notNull().default(true),
    effectiveFrom: timestamp('effective_from').defaultNow().notNull(),
    deactivatedAt: timestamp('deactivated_at'),
    changedByAdminId: integer('changed_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('reward_rates_material_active_idx').on(table.materialCategoryId, table.isActive),
    index('reward_rates_effective_idx').on(table.effectiveFrom),
  ]
);

export const weightVerifications = pgTable(
  'weight_verifications',
  {
    id: serial('id').primaryKey(),
    submissionId: integer('submission_id')
      .references(() => wasteSubmissions.id, { onDelete: 'restrict' })
      .notNull()
      .unique(),
    collectionRequestId: integer('collection_request_id')
      .references(() => collectionRequests.id, { onDelete: 'restrict' })
      .notNull()
      .unique(),
    verifiedByAdminId: integer('verified_by_admin_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    decision: text('decision').notNull(), // APPROVED | REJECTED
    verifiedEligibleWeightKg: numeric('verified_eligible_weight_kg', {
      precision: 10,
      scale: 2,
    }).notNull(),
    appliedRewardRateId: integer('applied_reward_rate_id').references(() => rewardRates.id, {
      onDelete: 'set null',
    }),
    appliedPointsPerKg: numeric('applied_points_per_kg', { precision: 10, scale: 2 }),
    appliedRateIsDemo: boolean('applied_rate_is_demo').notNull().default(true),
    pointsAwarded: numeric('points_awarded', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    reviewNotes: text('review_notes'),
    verifiedAt: timestamp('verified_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('weight_verifications_decision_idx').on(table.decision)]
);

// Stage 4: Redemption Configuration & Requests
export const redemptionSettings = pgTable('redemption_settings', {
  id: serial('id').primaryKey(),
  minRedemptionPoints: numeric('min_redemption_points', { precision: 12, scale: 2 })
    .notNull()
    .default('100.00'),
  pointsToNgnRate: numeric('points_to_ngn_rate', { precision: 10, scale: 4 })
    .notNull()
    .default('1.0000'),
  pointsToSatsRate: numeric('points_to_sats_rate', { precision: 10, scale: 4 })
    .notNull()
    .default('10.0000'),
  enabledMethodsJson: text('enabled_methods_json')
    .notNull()
    .default('["BITCOIN_LIGHTNING","BANK_TRANSFER","AIRTIME","MOBILE_DATA","CAMPUS_VOUCHER"]'),
  failedRedemptionPolicy: text('failed_redemption_policy')
    .notNull()
    .default('AUTO_REFUND_TO_WALLET'),
  isDemoRates: boolean('is_demo_rates').notNull().default(true),
  updatedByAdminId: integer('updated_by_admin_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const redemptionRequests = pgTable(
  'redemption_requests',
  {
    id: serial('id').primaryKey(),
    referenceCode: text('reference_code').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    walletId: integer('wallet_id')
      .references(() => rewardWallets.id, { onDelete: 'restrict' })
      .notNull(),
    pointsRequested: numeric('points_requested', { precision: 12, scale: 2 }).notNull(),
    method: text('method').notNull(),
    destinationSummary: text('destination_summary').notNull(),
    destinationDetailsJson: text('destination_details_json').notNull(),
    estimatedValueAmount: numeric('estimated_value_amount', { precision: 12, scale: 2 }).notNull(),
    estimatedValueUnit: text('estimated_value_unit').notNull(),
    conversionRateApplied: numeric('conversion_rate_applied', {
      precision: 10,
      scale: 4,
    }).notNull(),
    status: text('status').notNull().default('PENDING'),
    statusReason: text('status_reason'),
    payoutReference: text('payout_reference'),
    reviewedByAdminId: integer('reviewed_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    processedByAdminId: integer('processed_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewedAt: timestamp('reviewed_at'),
    paidAt: timestamp('paid_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('redemption_requests_user_idx').on(table.userId),
    index('redemption_requests_status_idx').on(table.status),
    index('redemption_requests_method_idx').on(table.method),
  ]
);

export const redemptionStatusHistory = pgTable(
  'redemption_status_history',
  {
    id: serial('id').primaryKey(),
    redemptionRequestId: integer('redemption_request_id')
      .references(() => redemptionRequests.id, { onDelete: 'cascade' })
      .notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    changedByUserId: integer('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    payoutReference: text('payout_reference'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('redemption_status_history_req_idx').on(table.redemptionRequestId)]
);

// Stage 4: Immutable Reward Transaction Ledger
export const rewardLedgerTransactions = pgTable(
  'reward_ledger_transactions',
  {
    id: serial('id').primaryKey(),
    referenceCode: text('reference_code').notNull().unique(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    walletId: integer('wallet_id')
      .references(() => rewardWallets.id, { onDelete: 'restrict' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    transactionType: text('transaction_type').notNull(),
    direction: text('direction').notNull(), // CREDIT | DEBIT
    amountPoints: numeric('amount_points', { precision: 12, scale: 2 }).notNull(),
    signedPoints: numeric('signed_points', { precision: 12, scale: 2 }).notNull(),
    balanceBefore: numeric('balance_before', { precision: 12, scale: 2 }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 12, scale: 2 }).notNull(),
    verificationId: integer('verification_id').references(() => weightVerifications.id, {
      onDelete: 'restrict',
    }),
    redemptionRequestId: integer('redemption_request_id').references(() => redemptionRequests.id, {
      onDelete: 'restrict',
    }),
    appliedRatePerKg: numeric('applied_rate_per_kg', { precision: 10, scale: 2 }),
    description: text('description').notNull(),
    status: text('status').notNull().default('POSTED'),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('reward_ledger_wallet_idx').on(table.walletId, table.createdAt),
    index('reward_ledger_user_idx').on(table.userId, table.createdAt),
    index('reward_ledger_type_idx').on(table.transactionType),
    index('reward_ledger_verification_idx').on(table.verificationId),
    index('reward_ledger_redemption_idx').on(table.redemptionRequestId),
  ]
);

// Stage 4 & 8: In-App Notifications & Preferences
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    actionRoute: text('action_route'),
    relatedType: text('related_type'),
    relatedId: text('related_id'),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('notifications_user_read_idx').on(table.userId, table.isRead, table.createdAt)]
);

export const notificationPreferences = pgTable('notification_preferences', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  collectionUpdates: boolean('collection_updates').notNull().default(true),
  verificationRewards: boolean('verification_rewards').notNull().default(true),
  redemptionUpdates: boolean('redemption_updates').notNull().default(true),
  learningUpdates: boolean('learning_updates').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Stage 5: Inventory, Storage Locations, Batches, Movements, Transfers & Sales
export const storageLocations = pgTable('storage_locations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  locationType: text('location_type').notNull().default('DEMO_STORAGE'),
  address: text('address').notNull(),
  communityArea: text('community_area').notNull(),
  description: text('description').notNull(),
  capacityKg: numeric('capacity_kg', { precision: 10, scale: 2 }),
  isActive: boolean('is_active').notNull().default(true),
  isDemo: boolean('is_demo').notNull().default(true),
  createdByAdminId: integer('created_by_admin_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const materialBatches = pgTable(
  'material_batches',
  {
    id: serial('id').primaryKey(),
    batchReference: text('batch_reference').notNull().unique(),
    materialCategoryId: integer('material_category_id')
      .references(() => materialCategories.id, { onDelete: 'restrict' })
      .notNull(),
    storageLocationId: integer('storage_location_id')
      .references(() => storageLocations.id, { onDelete: 'restrict' })
      .notNull(),
    totalWeightKg: numeric('total_weight_kg', { precision: 10, scale: 2 }).notNull(),
    availableWeightKg: numeric('available_weight_kg', { precision: 10, scale: 2 }).notNull(),
    reservedWeightKg: numeric('reserved_weight_kg', { precision: 10, scale: 2 })
      .notNull()
      .default('0.00'),
    status: text('status').notNull().default('OPEN'),
    createdByAdminId: integer('created_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('material_batches_category_idx').on(table.materialCategoryId),
    index('material_batches_location_idx').on(table.storageLocationId),
    index('material_batches_status_idx').on(table.status),
  ]
);

export const inventoryEntries = pgTable(
  'inventory_entries',
  {
    id: serial('id').primaryKey(),
    referenceCode: text('reference_code').notNull().unique(),
    verificationId: integer('verification_id')
      .references(() => weightVerifications.id, { onDelete: 'restrict' })
      .notNull()
      .unique(),
    collectionRequestId: integer('collection_request_id')
      .references(() => collectionRequests.id, { onDelete: 'restrict' })
      .notNull(),
    materialCategoryId: integer('material_category_id')
      .references(() => materialCategories.id, { onDelete: 'restrict' })
      .notNull(),
    storageLocationId: integer('storage_location_id')
      .references(() => storageLocations.id, { onDelete: 'restrict' })
      .notNull(),
    qualityGrade: text('quality_grade').notNull(),
    initialWeightKg: numeric('initial_weight_kg', { precision: 10, scale: 2 }).notNull(),
    availableWeightKg: numeric('available_weight_kg', { precision: 10, scale: 2 }).notNull(),
    reservedWeightKg: numeric('reserved_weight_kg', { precision: 10, scale: 2 })
      .notNull()
      .default('0.00'),
    status: text('status').notNull().default('RECEIVED'),
    batchId: integer('batch_id').references(() => materialBatches.id, { onDelete: 'set null' }),
    isDemo: boolean('is_demo').notNull().default(false),
    notes: text('notes'),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('inventory_entries_category_idx').on(table.materialCategoryId),
    index('inventory_entries_location_idx').on(table.storageLocationId),
    index('inventory_entries_status_idx').on(table.status),
    index('inventory_entries_batch_idx').on(table.batchId),
  ]
);

export const batchSourceAllocations = pgTable(
  'batch_source_allocations',
  {
    id: serial('id').primaryKey(),
    batchId: integer('batch_id')
      .references(() => materialBatches.id, { onDelete: 'cascade' })
      .notNull(),
    inventoryEntryId: integer('inventory_entry_id')
      .references(() => inventoryEntries.id, { onDelete: 'restrict' })
      .notNull(),
    verificationId: integer('verification_id')
      .references(() => weightVerifications.id, { onDelete: 'restrict' })
      .notNull(),
    collectionRequestId: integer('collection_request_id')
      .references(() => collectionRequests.id, { onDelete: 'restrict' })
      .notNull(),
    allocatedWeightKg: numeric('allocated_weight_kg', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('batch_allocations_batch_idx').on(table.batchId),
    index('batch_allocations_entry_idx').on(table.inventoryEntryId),
  ]
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: serial('id').primaryKey(),
    referenceCode: text('reference_code').notNull().unique(),
    movementType: text('movement_type').notNull(),
    materialCategoryId: integer('material_category_id')
      .references(() => materialCategories.id, { onDelete: 'restrict' })
      .notNull(),
    inventoryEntryId: integer('inventory_entry_id').references(() => inventoryEntries.id, {
      onDelete: 'set null',
    }),
    batchId: integer('batch_id').references(() => materialBatches.id, { onDelete: 'set null' }),
    fromLocationId: integer('from_location_id').references(() => storageLocations.id, {
      onDelete: 'set null',
    }),
    toLocationId: integer('to_location_id').references(() => storageLocations.id, {
      onDelete: 'set null',
    }),
    quantityDeltaKg: numeric('quantity_delta_kg', { precision: 10, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('inventory_movements_type_idx').on(table.movementType),
    index('inventory_movements_batch_idx').on(table.batchId),
  ]
);

export const materialTransfers = pgTable(
  'material_transfers',
  {
    id: serial('id').primaryKey(),
    referenceCode: text('reference_code').notNull().unique(),
    batchId: integer('batch_id')
      .references(() => materialBatches.id, { onDelete: 'restrict' })
      .notNull(),
    materialCategoryId: integer('material_category_id')
      .references(() => materialCategories.id, { onDelete: 'restrict' })
      .notNull(),
    sourceLocationId: integer('source_location_id')
      .references(() => storageLocations.id, { onDelete: 'restrict' })
      .notNull(),
    destinationLocationId: integer('destination_location_id')
      .references(() => storageLocations.id, { onDelete: 'restrict' })
      .notNull(),
    quantityKg: numeric('quantity_kg', { precision: 10, scale: 2 }).notNull(),
    status: text('status').notNull().default('PENDING'),
    responsibleParty: text('responsible_party').notNull(),
    notes: text('notes'),
    initiatedByAdminId: integer('initiated_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    confirmedByAdminId: integer('confirmed_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    transferDate: timestamp('transfer_date').defaultNow().notNull(),
    confirmedAt: timestamp('confirmed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('material_transfers_batch_idx').on(table.batchId),
    index('material_transfers_status_idx').on(table.status),
  ]
);

export const materialSales = pgTable(
  'material_sales',
  {
    id: serial('id').primaryKey(),
    referenceCode: text('reference_code').notNull().unique(),
    batchId: integer('batch_id')
      .references(() => materialBatches.id, { onDelete: 'restrict' })
      .notNull(),
    materialCategoryId: integer('material_category_id')
      .references(() => materialCategories.id, { onDelete: 'restrict' })
      .notNull(),
    buyerName: text('buyer_name').notNull(),
    buyerContact: text('buyer_contact'),
    quantityKg: numeric('quantity_kg', { precision: 10, scale: 2 }).notNull(),
    unitPriceNgn: numeric('unit_price_ngn', { precision: 12, scale: 2 }),
    totalValueNgn: numeric('total_value_ngn', { precision: 14, scale: 2 })
      .notNull()
      .default('0.00'),
    transferStatus: text('transfer_status').notNull().default('PENDING'),
    paymentStatus: text('payment_status').notNull().default('UNPAID'),
    documentationRef: text('documentation_ref'),
    notes: text('notes'),
    recordedByAdminId: integer('recorded_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    saleDate: timestamp('sale_date').defaultNow().notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('material_sales_batch_idx').on(table.batchId),
    index('material_sales_payment_idx').on(table.paymentStatus),
  ]
);

// Stage 6: Bitcoin Lightning, NWC & Nostr Integrations
export const integrationSettings = pgTable('integration_settings', {
  id: serial('id').primaryKey(),
  lightningEnabled: boolean('lightning_enabled').notNull().default(true),
  lightningMode: text('lightning_mode').notNull().default('DEMO'), // DISABLED | DEMO | NWC_LIVE
  nwcEncryptedSecret: text('nwc_encrypted_secret'),
  nwcWalletPubkeyPreview: text('nwc_wallet_pubkey_preview'),
  nwcRelayHost: text('nwc_relay_host'),
  nwcStatus: text('nwc_status').notNull().default('DISCONNECTED'),
  nwcLastCheckedAt: timestamp('nwc_last_checked_at'),
  nwcLastError: text('nwc_last_error'),
  nostrEnabled: boolean('nostr_enabled').notNull().default(true),
  nostrMode: text('nostr_mode').notNull().default('DEMO'), // DISABLED | DEMO | RELAY_LIVE
  nostrRelayUrlsJson: text('nostr_relay_urls_json')
    .notNull()
    .default('["wss://relay.damus.io","wss://nos.lol"]'),
  nostrPublisherPubkey: text('nostr_publisher_pubkey'),
  nostrAutoPublish: boolean('nostr_auto_publish').notNull().default(false),
  aiSorterEnabled: boolean('ai_sorter_enabled').notNull().default(true),
  aiProvider: text('ai_provider').notNull().default('GEMINI'),
  updatedByAdminId: integer('updated_by_admin_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userNwcConnections = pgTable('user_nwc_connections', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  label: text('label').notNull().default('Lightning Wallet'),
  encryptedUri: text('encrypted_uri').notNull(),
  relayHost: text('relay_host').notNull(),
  walletPubkeyPreview: text('wallet_pubkey_preview').notNull(),
  status: text('status').notNull().default('CONNECTED'),
  lastValidatedAt: timestamp('last_validated_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const lightningPayments = pgTable(
  'lightning_payments',
  {
    id: serial('id').primaryKey(),
    redemptionRequestId: integer('redemption_request_id')
      .references(() => redemptionRequests.id, { onDelete: 'restrict' })
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    mode: text('mode').notNull().default('DEMO_SIMULATED'),
    destination: text('destination').notNull(),
    amountSats: integer('amount_sats').notNull(),
    status: text('status').notNull().default('INITIATED'), // INITIATED | PAID | FAILED
    paymentReference: text('payment_reference'),
    providerResponseSummary: text('provider_response_summary'),
    errorMessage: text('error_message'),
    initiatedByAdminId: integer('initiated_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    isSimulated: boolean('is_simulated').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('lightning_payments_redemption_idx').on(table.redemptionRequestId)]
);

export const nostrAuthChallenges = pgTable('nostr_auth_challenges', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  challengeNonce: text('challenge_nonce').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const nostrPublications = pgTable(
  'nostr_publications',
  {
    id: serial('id').primaryKey(),
    verificationId: integer('verification_id')
      .references(() => weightVerifications.id, { onDelete: 'restrict' })
      .notNull()
      .unique(),
    collectionRequestId: integer('collection_request_id')
      .references(() => collectionRequests.id, { onDelete: 'restrict' })
      .notNull(),
    mode: text('mode').notNull().default('DEMO_SIMULATED'),
    pilotHub: text('pilot_hub').notNull().default('FUTO-Owerri'),
    materialCategoryName: text('material_category_name').notNull(),
    verifiedWeightKg: numeric('verified_weight_kg', { precision: 10, scale: 2 }).notNull(),
    payloadContent: text('payload_content').notNull(),
    eventId: text('event_id'),
    relaysTargetedJson: text('relays_targeted_json').notNull().default('[]'),
    status: text('status').notNull().default('PENDING'), // PENDING | PUBLISHED | SIMULATED | FAILED
    retryCount: integer('retry_count').notNull().default(0),
    lastError: text('last_error'),
    isDemo: boolean('is_demo').notNull().default(true),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('nostr_publications_status_idx').on(table.status)]
);

// Stage 7: AI Waste Sorter & Learn and Earn
export const aiClassifications = pgTable(
  'ai_classifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    inputType: text('input_type').notNull(),
    inputSummary: text('input_summary').notNull(),
    suggestedCategoryId: integer('suggested_category_id').references(() => materialCategories.id, {
      onDelete: 'set null',
    }),
    suggestedCategoryName: text('suggested_category_name').notNull(),
    confidenceLevel: text('confidence_level').notNull(),
    isAcceptedMaterial: boolean('is_accepted_material').notNull().default(false),
    providerUsed: text('provider_used').notNull(),
    explanation: text('explanation').notNull(),
    preparationGuidance: text('preparation_guidance').notNull(),
    contaminationObservations: text('contamination_observations').notNull(),
    pidginSummary: text('pidgin_summary').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ai_classifications_user_idx').on(table.userId, table.createdAt)]
);

export const learningModules = pgTable('learning_modules', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  topic: text('topic').notNull(),
  lessonsJson: text('lessons_json').notNull(),
  quizQuestionsJson: text('quiz_questions_json').notNull(),
  passingScorePercent: integer('passing_score_percent').notNull().default(67),
  bonusPoints: numeric('bonus_points', { precision: 10, scale: 2 }).notNull().default('25.00'),
  isDemoBonus: boolean('is_demo_bonus').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  updatedByAdminId: integer('updated_by_admin_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const learningCompletions = pgTable(
  'learning_completions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    moduleId: integer('module_id')
      .references(() => learningModules.id, { onDelete: 'cascade' })
      .notNull(),
    bestScorePercent: integer('best_score_percent').notNull().default(0),
    attemptsCount: integer('attempts_count').notNull().default(1),
    passed: boolean('passed').notNull().default(false),
    bonusPointsAwarded: numeric('bonus_points_awarded', { precision: 10, scale: 2 })
      .notNull()
      .default('0.00'),
    ledgerTransactionId: integer('ledger_transaction_id').references(
      () => rewardLedgerTransactions.id,
      { onDelete: 'set null' }
    ),
    completedAt: timestamp('completed_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('learning_completions_user_module_uidx').on(table.userId, table.moduleId)]
);

export const partnershipInquiries = pgTable('partnership_inquiries', {
  id: serial('id').primaryKey(),
  organizationName: text('organization_name').notNull(),
  contactName: text('contact_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  partnerType: text('partner_type').notNull(),
  message: text('message').notNull(),
  status: text('status').notNull().default('NEW'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    details: text('details'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_logs_actor_idx').on(table.actorUserId)]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  agentProfile: one(collectionAgentProfiles, {
    fields: [users.id],
    references: [collectionAgentProfiles.userId],
  }),
  wallet: one(rewardWallets, {
    fields: [users.id],
    references: [rewardWallets.userId],
  }),
  sessions: many(userSessions),
  collectionRequests: many(collectionRequests),
  auditLogs: many(auditLogs),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const collectionAgentProfilesRelations = relations(collectionAgentProfiles, ({ one }) => ({
  user: one(users, {
    fields: [collectionAgentProfiles.userId],
    references: [users.id],
  }),
}));

export const rewardWalletsRelations = relations(rewardWallets, ({ one }) => ({
  user: one(users, {
    fields: [rewardWallets.userId],
    references: [users.id],
  }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
}));

export const collectionRequestsRelations = relations(collectionRequests, ({ one, many }) => ({
  user: one(users, {
    fields: [collectionRequests.userId],
    references: [users.id],
  }),
  materialCategory: one(materialCategories, {
    fields: [collectionRequests.materialCategoryId],
    references: [materialCategories.id],
  }),
  collectionPoint: one(collectionPoints, {
    fields: [collectionRequests.collectionPointId],
    references: [collectionPoints.id],
  }),
  assignments: many(collectionAssignments),
  submission: one(wasteSubmissions, {
    fields: [collectionRequests.id],
    references: [wasteSubmissions.collectionRequestId],
  }),
  verification: one(weightVerifications, {
    fields: [collectionRequests.id],
    references: [weightVerifications.collectionRequestId],
  }),
}));

export const collectionAssignmentsRelations = relations(collectionAssignments, ({ one }) => ({
  request: one(collectionRequests, {
    fields: [collectionAssignments.collectionRequestId],
    references: [collectionRequests.id],
  }),
  agent: one(users, {
    fields: [collectionAssignments.agentUserId],
    references: [users.id],
  }),
  assignedBy: one(users, {
    fields: [collectionAssignments.assignedByUserId],
    references: [users.id],
  }),
}));

export const wasteSubmissionsRelations = relations(wasteSubmissions, ({ one }) => ({
  request: one(collectionRequests, {
    fields: [wasteSubmissions.collectionRequestId],
    references: [collectionRequests.id],
  }),
  assignment: one(collectionAssignments, {
    fields: [wasteSubmissions.assignmentId],
    references: [collectionAssignments.id],
  }),
  agent: one(users, {
    fields: [wasteSubmissions.recordedByAgentId],
    references: [users.id],
  }),
  materialCategory: one(materialCategories, {
    fields: [wasteSubmissions.materialCategoryId],
    references: [materialCategories.id],
  }),
  verification: one(weightVerifications, {
    fields: [wasteSubmissions.id],
    references: [weightVerifications.submissionId],
  }),
}));

export const weightVerificationsRelations = relations(weightVerifications, ({ one }) => ({
  submission: one(wasteSubmissions, {
    fields: [weightVerifications.submissionId],
    references: [wasteSubmissions.id],
  }),
  request: one(collectionRequests, {
    fields: [weightVerifications.collectionRequestId],
    references: [collectionRequests.id],
  }),
  verifiedByAdmin: one(users, {
    fields: [weightVerifications.verifiedByAdminId],
    references: [users.id],
  }),
  appliedRewardRate: one(rewardRates, {
    fields: [weightVerifications.appliedRewardRateId],
    references: [rewardRates.id],
  }),
}));

export const rewardRatesRelations = relations(rewardRates, ({ one }) => ({
  materialCategory: one(materialCategories, {
    fields: [rewardRates.materialCategoryId],
    references: [materialCategories.id],
  }),
  changedByAdmin: one(users, {
    fields: [rewardRates.changedByAdminId],
    references: [users.id],
  }),
}));

export const redemptionRequestsRelations = relations(redemptionRequests, ({ one, many }) => ({
  user: one(users, {
    fields: [redemptionRequests.userId],
    references: [users.id],
  }),
  wallet: one(rewardWallets, {
    fields: [redemptionRequests.walletId],
    references: [rewardWallets.id],
  }),
  statusHistory: many(redemptionStatusHistory),
}));

export const redemptionStatusHistoryRelations = relations(redemptionStatusHistory, ({ one }) => ({
  redemptionRequest: one(redemptionRequests, {
    fields: [redemptionStatusHistory.redemptionRequestId],
    references: [redemptionRequests.id],
  }),
  changedBy: one(users, {
    fields: [redemptionStatusHistory.changedByUserId],
    references: [users.id],
  }),
}));

export const rewardLedgerTransactionsRelations = relations(
  rewardLedgerTransactions,
  ({ one }) => ({
    wallet: one(rewardWallets, {
      fields: [rewardLedgerTransactions.walletId],
      references: [rewardWallets.id],
    }),
    user: one(users, {
      fields: [rewardLedgerTransactions.userId],
      references: [users.id],
    }),
    verification: one(weightVerifications, {
      fields: [rewardLedgerTransactions.verificationId],
      references: [weightVerifications.id],
    }),
    redemptionRequest: one(redemptionRequests, {
      fields: [rewardLedgerTransactions.redemptionRequestId],
      references: [redemptionRequests.id],
    }),
  })
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [auditLogs.actorUserId],
    references: [users.id],
  }),
}));
