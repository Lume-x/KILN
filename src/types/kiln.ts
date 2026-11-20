export type UserRole = 'USER' | 'AGENT' | 'ADMIN';

export type AppRoute =
  | '/'
  | '/login'
  | '/register'
  | '/account'
  | '/collections'
  | '/wallet'
  | '/learn'
  | '/agent'
  | '/admin';

export type CollectionMethod = 'PICKUP' | 'DROP_OFF';

export type CollectionRequestStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'ASSIGNED'
  | 'ACCEPTED_BY_AGENT'
  | 'IN_PROGRESS'
  | 'COLLECTED'
  | 'AWAITING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'CANCELLED';

export type QualityGrade = 'A_CLEAN' | 'B_STANDARD' | 'C_MIXED' | 'REJECTED';

export type RedemptionMethod =
  | 'BITCOIN_LIGHTNING'
  | 'BANK_TRANSFER'
  | 'AIRTIME'
  | 'MOBILE_DATA'
  | 'LOCAL_VOUCHER';

export type RedemptionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'PROCESSING'
  | 'PAID'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED';

export type LedgerTransactionType =
  | 'COLLECTION_REWARD'
  | 'LEARNING_BONUS'
  | 'REDEMPTION'
  | 'ADMIN_ADJUSTMENT'
  | 'REVERSAL';

export interface UserWalletSummary {
  availablePoints: string;
  totalEarnedPoints: string;
  totalRedeemedPoints: string;
  pendingRedemptionPoints: string;
}

export interface KilnUser {
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
  createdAt: string;
  wallet: UserWalletSummary;
}

export interface MaterialCategory {
  id: number;
  name: string;
  slug: string;
  description: string;
  imageUrl: string;
  unit: string;
  rewardRateDemo: string | null;
  isRateConfigured: boolean;
  acceptanceInfo: string;
  preparationRequirements: string;
  contaminationRules: string;
  streamType: string;
  isActive?: boolean;
  displayOrder: number;
}

export interface CollectionPoint {
  id: number;
  name: string;
  slug: string;
  address: string;
  communityArea: string;
  description: string;
  contactInfo: string | null;
  operatingHours: string;
  status: string;
  isDemo: boolean;
  latitude?: string | null;
  longitude?: string | null;
}

export interface CollectionRequestRecord {
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
  createdAt: string;
  updatedAt: string;
  activeAssignment: {
    id: number;
    agentUserId: number;
    agentName: string;
    agentEmail: string;
    status: string;
    agentResponseNote: string | null;
    assignedAt: string;
    respondedAt: string | null;
    startedAt: string | null;
    collectedAt: string | null;
  } | null;
  submission: {
    id: number;
    materialCategoryId: number;
    materialName: string;
    actualWeightKg: string;
    rejectedWeightKg: string;
    eligibleWeightKg: string;
    qualityGrade: QualityGrade;
    contaminationNotes: string | null;
    agentNotes: string | null;
    evidencePhotoUrl: string | null;
    recordedByAgentId: number;
    recordedByAgentName: string;
    collectedAt: string;
    createdAt: string;
  } | null;
  verification: {
    id: number;
    decision: 'APPROVED' | 'REJECTED';
    verifiedEligibleWeightKg: string;
    appliedRewardRateId: number | null;
    appliedPointsPerKg: string | null;
    appliedRateIsDemo: boolean;
    pointsAwarded: string;
    reviewNotes: string | null;
    verifiedByAdminId: number;
    verifiedByAdminName: string;
    verifiedAt: string;
  } | null;
}

export interface AgentSummary {
  id: number;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  serviceZone: string;
  isAvailable: boolean;
}

export interface ImpactSummary {
  verifiedKilograms: string;
  verifiedCollections: number;
  registeredParticipants: number;
  acceptedMaterialCategories: number;
  hasVerifiedCollections: boolean;
  pilotArea: string;
}

export interface RedemptionSettingsRecord {
  id?: number;
  minRedemptionPoints: string;
  pointsToNgnRate: string;
  pointsToSatsRate: string;
  enabledMethods: RedemptionMethod[];
  isDemoRates: boolean;
  updatedAt?: string;
}

export interface RewardLedgerEntry {
  id: number;
  referenceCode: string;
  userId: number;
  userName?: string;
  userEmail?: string;
  transactionType: LedgerTransactionType;
  direction: 'CREDIT' | 'DEBIT';
  amountPoints: string;
  signedPoints: string;
  balanceBefore: string;
  balanceAfter: string;
  verificationId: number | null;
  redemptionRequestId: number | null;
  appliedRatePerKg: string | null;
  description: string;
  status: string;
  isDemo: boolean;
  createdAt: string;
}

export interface RedemptionRecord {
  id: number;
  referenceCode: string;
  userId: number;
  userName: string;
  userEmail: string;
  pointsRequested: string;
  method: RedemptionMethod;
  destinationMasked: string;
  destinationDetails: string;
  estimatedNgnValue: string | null;
  estimatedSatsValue: number | null;
  status: RedemptionStatus;
  payoutReference: string | null;
  isSimulatedPayout: boolean;
  reviewNote: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: Array<{
    id: number;
    fromStatus: string | null;
    toStatus: string;
    note: string | null;
    actorName: string;
    createdAt: string;
  }>;
}

export interface NotificationRecord {
  id: number;
  eventType: string;
  title: string;
  message: string;
  actionRoute: string | null;
  relatedType: string | null;
  relatedId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferencesRecord {
  collectionUpdates: boolean;
  verificationRewards: boolean;
  redemptionUpdates: boolean;
  learningUpdates: boolean;
}

export interface AiClassificationResult {
  id: number;
  suggestedCategoryId: number | null;
  suggestedCategoryName: string;
  confidenceScore: number;
  isUncertain: boolean;
  isAcceptedMaterial: boolean;
  preparationGuidance: string;
  contaminationWarning: string | null;
  pidginSummary: string;
  providerUsed: string;
  modelName: string | null;
  fallbackUsed: boolean;
  disclaimer: string;
  createdAt: string;
}

export interface LearningQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex?: number;
  explanation?: string;
}

export interface LearningModuleForUser {
  id: number;
  slug: string;
  title: string;
  summary: string;
  topic: string;
  contentEnglish: string;
  contentPidgin: string | null;
  passingScorePercent: number;
  bonusPoints: string;
  isDemo: boolean;
  questions: LearningQuestion[];
  completion: {
    passed: boolean;
    bestScorePercent: number;
    attemptsCount: number;
    bonusCredited: boolean;
    completedAt: string | null;
  } | null;
}

export const PILOT_COMMUNITY_AREAS = [
  'FUTO Campus',
  'Ihiagwa',
  'Eziobodo',
  'Obinze',
  'Umuchima',
  'Nekede',
  'Owerri Municipal',
  'Other (Imo State)',
] as const;

export const PREFERRED_COLLECTION_WINDOWS = [
  'Weekday Morning (09:00 – 12:00)',
  'Weekday Afternoon (12:00 – 16:00)',
  'Saturday Morning (09:00 – 13:00)',
  'Flexible — Contact me before arrival',
] as const;
