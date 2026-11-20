import crypto from 'node:crypto';
import type { CollectionRequestStatus, QualityGrade } from '../db/schema.ts';

export const ALLOWED_TRANSITIONS: Record<CollectionRequestStatus, CollectionRequestStatus[]> = {
  PENDING: ['APPROVED', 'ASSIGNED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['ASSIGNED', 'REJECTED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED_BY_AGENT', 'APPROVED', 'CANCELLED'],
  ACCEPTED_BY_AGENT: ['IN_PROGRESS', 'APPROVED'],
  IN_PROGRESS: ['COLLECTED'],
  COLLECTED: ['AWAITING_VERIFICATION'],
  AWAITING_VERIFICATION: ['VERIFIED', 'REJECTED'],
  VERIFIED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const VALID_QUALITY_GRADES = new Set<QualityGrade>([
  'A_CLEAN',
  'B_STANDARD',
  'C_MIXED',
  'REJECTED',
]);

export function canTransitionCollectionStatus(
  from: CollectionRequestStatus,
  to: CollectionRequestStatus
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function generateCollectionReference(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `KILN-${y}${m}${d}-${suffix}`;
}

/**
 * Exact 2-decimal-place kilogram parser using integer centigrams (1 kg = 100 units)
 * to avoid floating-point drift in weights and downstream reward math.
 */
export function parseCentigrams(input: unknown): number | null {
  if (input === null || input === undefined || input === '') {
    return null;
  }
  const str = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return null;
  }
  const [wholePart, fracPart = ''] = str.split('.');
  const paddedFrac = (fracPart + '00').slice(0, 2);
  const value = Number(wholePart) * 100 + Number(paddedFrac);
  if (!Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

export function formatCentigramsToKg(centigrams: number): string {
  const safe = Math.max(0, Math.round(centigrams));
  const whole = Math.floor(safe / 100);
  const frac = String(safe % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}

export interface ValidatedWeightTriplet {
  actualWeightKg: string;
  rejectedWeightKg: string;
  eligibleWeightKg: string;
  actualCg: number;
  rejectedCg: number;
  eligibleCg: number;
}

export function validateWeightTriplet(input: {
  actualWeightKg: unknown;
  rejectedWeightKg: unknown;
  eligibleWeightKg?: unknown;
}): { ok: true; value: ValidatedWeightTriplet } | { ok: false; error: string } {
  const actualCg = parseCentigrams(input.actualWeightKg);
  if (actualCg === null || actualCg <= 0) {
    return { ok: false, error: 'Actual weight must be a positive number with up to 2 decimal places (kg).' };
  }
  if (actualCg > 500000) {
    return { ok: false, error: 'Actual weight exceeds the single-collection limit of 5,000.00 kg.' };
  }

  const rejectedCg =
    input.rejectedWeightKg === undefined ||
    input.rejectedWeightKg === null ||
    input.rejectedWeightKg === ''
      ? 0
      : parseCentigrams(input.rejectedWeightKg);

  if (rejectedCg === null || rejectedCg < 0) {
    return { ok: false, error: 'Rejected weight must be 0 or a positive number with up to 2 decimal places.' };
  }

  if (rejectedCg > actualCg) {
    return { ok: false, error: 'Rejected weight cannot exceed actual weighed weight.' };
  }

  const maxEligibleCg = actualCg - rejectedCg;

  let eligibleCg: number;
  if (
    input.eligibleWeightKg === undefined ||
    input.eligibleWeightKg === null ||
    input.eligibleWeightKg === ''
  ) {
    eligibleCg = maxEligibleCg;
  } else {
    const parsedEligible = parseCentigrams(input.eligibleWeightKg);
    if (parsedEligible === null || parsedEligible < 0) {
      return { ok: false, error: 'Eligible weight must be 0 or a positive number with up to 2 decimal places.' };
    }
    if (parsedEligible > maxEligibleCg) {
      return {
        ok: false,
        error: `Eligible weight (${formatCentigramsToKg(parsedEligible)} kg) cannot exceed accepted weight after rejections (${formatCentigramsToKg(maxEligibleCg)} kg).`,
      };
    }
    eligibleCg = parsedEligible;
  }

  return {
    ok: true,
    value: {
      actualWeightKg: formatCentigramsToKg(actualCg),
      rejectedWeightKg: formatCentigramsToKg(rejectedCg),
      eligibleWeightKg: formatCentigramsToKg(eligibleCg),
      actualCg,
      rejectedCg,
      eligibleCg,
    },
  };
}

const ALLOWED_IMAGE_DATA_URL_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
];

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB

function hasValidImageMagicBytes(prefix: string, headerBytes: Buffer): boolean {
  if (prefix === 'data:image/jpeg;base64,' || prefix === 'data:image/jpg;base64,') {
    return (
      headerBytes.length >= 3 &&
      headerBytes[0] === 0xff &&
      headerBytes[1] === 0xd8 &&
      headerBytes[2] === 0xff
    );
  }
  if (prefix === 'data:image/png;base64,') {
    return (
      headerBytes.length >= 8 &&
      headerBytes[0] === 0x89 &&
      headerBytes[1] === 0x50 &&
      headerBytes[2] === 0x4e &&
      headerBytes[3] === 0x47 &&
      headerBytes[4] === 0x0d &&
      headerBytes[5] === 0x0a &&
      headerBytes[6] === 0x1a &&
      headerBytes[7] === 0x0a
    );
  }
  if (prefix === 'data:image/webp;base64,') {
    return (
      headerBytes.length >= 12 &&
      headerBytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      headerBytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

export function validateUploadedPhoto(
  input: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (input === undefined || input === null || input === '') {
    return { ok: true, value: null };
  }
  if (typeof input !== 'string') {
    return { ok: false, error: 'Invalid photo format.' };
  }
  const trimmed = input.trim();
  const matchedPrefix = ALLOWED_IMAGE_DATA_URL_PREFIXES.find((p) => trimmed.startsWith(p));
  if (!matchedPrefix) {
    return {
      ok: false,
      error: 'Only JPEG, PNG, or WebP photograph uploads are permitted.',
    };
  }
  const base64Body = trimmed.slice(matchedPrefix.length);
  if (!base64Body || !/^[A-Za-z0-9+/=]+$/.test(base64Body)) {
    return { ok: false, error: 'Uploaded photograph data is malformed.' };
  }
  const approxBytes = Math.floor((base64Body.length * 3) / 4);
  if (approxBytes > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'Photograph must be 2 MB or smaller.' };
  }
  const headerSlice = Buffer.from(base64Body.slice(0, 32), 'base64');
  if (!hasValidImageMagicBytes(matchedPrefix, headerSlice)) {
    return {
      ok: false,
      error: 'Uploaded file signature does not match a valid JPEG, PNG, or WebP image.',
    };
  }
  return { ok: true, value: trimmed };
}

export function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
