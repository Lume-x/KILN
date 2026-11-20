import type {
  CollectionMethod,
  CollectionRequestStatus,
  LedgerTransactionType,
  QualityGrade,
  RedemptionMethod,
  RedemptionStatus,
} from '../types/kiln';

export const STATUS_META: Record<
  CollectionRequestStatus,
  { label: string; textClass: string; summary: string }
> = {
  PENDING: {
    label: 'Pending Review',
    textClass: 'text-[#8A4E11]',
    summary: 'Waiting for KILN coordinator review or agent assignment.',
  },
  APPROVED: {
    label: 'Approved',
    textClass: 'text-[#17372D]',
    summary: 'Approved and ready for a collection agent to be assigned.',
  },
  ASSIGNED: {
    label: 'Agent Assigned',
    textClass: 'text-[#17372D]',
    summary: 'Assigned to a collection agent awaiting confirmation.',
  },
  ACCEPTED_BY_AGENT: {
    label: 'Accepted by Agent',
    textClass: 'text-[#17372D]',
    summary: 'Collection agent confirmed and scheduled for handover.',
  },
  IN_PROGRESS: {
    label: 'In Progress',
    textClass: 'text-[#8A4E11]',
    summary: 'Agent is actively handling pickup or drop-off inspection.',
  },
  COLLECTED: {
    label: 'Collected',
    textClass: 'text-[#17372D]',
    summary: 'Materials collected; awaiting physical weight submission.',
  },
  AWAITING_VERIFICATION: {
    label: 'Awaiting Verification',
    textClass: 'text-[#8A4E11]',
    summary: 'Physical weight recorded by agent; awaiting administrator verification.',
  },
  VERIFIED: {
    label: 'Verified',
    textClass: 'text-[#14532D]',
    summary: 'Weight verified and approved by KILN administrator.',
  },
  REJECTED: {
    label: 'Rejected',
    textClass: 'text-[#991B1B]',
    summary: 'Request or weight verification was rejected.',
  },
  CANCELLED: {
    label: 'Cancelled',
    textClass: 'text-[#59605B]',
    summary: 'Cancelled prior to collection.',
  },
};

export const REDEMPTION_STATUS_META: Record<
  RedemptionStatus,
  { label: string; textClass: string }
> = {
  PENDING: { label: 'Pending Review', textClass: 'text-[#8A4E11]' },
  APPROVED: { label: 'Approved', textClass: 'text-[#17372D]' },
  PROCESSING: { label: 'Processing Payout', textClass: 'text-[#8A4E11]' },
  PAID: { label: 'Paid', textClass: 'text-[#14532D]' },
  REJECTED: { label: 'Rejected (Reversed)', textClass: 'text-[#991B1B]' },
  FAILED: { label: 'Failed (Reversed)', textClass: 'text-[#991B1B]' },
  CANCELLED: { label: 'Cancelled (Reversed)', textClass: 'text-[#59605B]' },
};

export const REDEMPTION_METHOD_LABELS: Record<RedemptionMethod, string> = {
  BITCOIN_LIGHTNING: 'Bitcoin Lightning',
  BANK_TRANSFER: 'Bank Transfer (NGN)',
  AIRTIME: 'Mobile Airtime',
  MOBILE_DATA: 'Mobile Data Bundle',
  LOCAL_VOUCHER: 'Local Campus / Community Voucher',
};

export const LEDGER_TYPE_LABELS: Record<LedgerTransactionType, string> = {
  COLLECTION_REWARD: 'Collection Reward',
  LEARNING_BONUS: 'Learn & Earn Bonus',
  REDEMPTION: 'Redemption Hold',
  ADMIN_ADJUSTMENT: 'Admin Adjustment',
  REVERSAL: 'Redemption Reversal',
};

export const QUALITY_GRADE_LABELS: Record<QualityGrade, string> = {
  A_CLEAN: 'Grade A — Clean & Sorted',
  B_STANDARD: 'Grade B — Standard Acceptable',
  C_MIXED: 'Grade C — Minor Contamination',
  REJECTED: 'Rejected — Unsuitable / Contaminated',
};

export function formatMethodLabel(method: CollectionMethod): string {
  return method === 'PICKUP' ? 'Scheduled Pickup' : 'Approved Drop-Off';
}

export function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedTypes.has(file.type)) {
      reject(new Error('Please upload a JPEG, PNG, or WebP photograph.'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error('Photograph must be 2 MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read the selected image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}
