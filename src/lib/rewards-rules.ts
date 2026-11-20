import crypto from 'node:crypto';
import type { RedemptionMethod, RedemptionStatus } from '../db/schema.ts';

/**
 * KILN Stage 4–8 Exact Decimal Arithmetic & Business Rules
 *
 * Rounding Policy:
 * - Weights are stored to 2 decimal places (kg) and represented internally as integer centigrams (1 kg = 100 cg).
 * - Reward rates and point balances are stored to 2 decimal places and represented internally as integer centipoints (1 pt = 100 cp).
 * - Reward calculation: points_earned = verified_eligible_weight_kg * applied_points_per_kg
 *   Exact integer product has 4 decimal places (eligibleCg * rateCp).
 *   Rounded to 2 decimal places using HALF_UP rounding: (product + 50n) / 100n.
 * - Value estimates (NGN / SATS preview): conversion rates have 4 decimal places (rate * 10000).
 *   Product (pointsCp * rateTenThousandths) has 6 decimal places, rounded HALF_UP to 2 decimal places: (product + 5000n) / 10000n.
 */

export const ROUNDING_POLICY_DESCRIPTION =
  'Exact fixed-point decimal arithmetic with Round Half-Up (HALF_UP) to 2 decimal places.';

export function parseDecimalToScaledInt(input: unknown, decimals: number): bigint | null {
  if (input === null || input === undefined || input === '') {
    return null;
  }
  const str = String(input).trim();
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(str)) {
    return null;
  }
  const [wholePart, fracPart = ''] = str.split('.');
  const paddedFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const scale = 10n ** BigInt(decimals);
  return BigInt(wholePart) * scale + BigInt(paddedFrac);
}

export function parseSignedDecimalToScaledInt(input: unknown, decimals: number): bigint | null {
  if (input === null || input === undefined || input === '') {
    return null;
  }
  const str = String(input).trim();
  const isNeg = str.startsWith('-');
  const unsigned = isNeg || str.startsWith('+') ? str.slice(1) : str;
  const mag = parseDecimalToScaledInt(unsigned, decimals);
  if (mag === null) return null;
  return isNeg ? -mag : mag;
}

export function formatScaledIntToDecimal(value: bigint, decimals: number): string {
  const isNeg = value < 0n;
  const abs = isNeg ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, '0');
  return `${isNeg ? '-' : ''}${whole.toString()}.${frac}`;
}

export function parsePointsToCents(input: unknown): bigint | null {
  return parseDecimalToScaledInt(input, 2);
}

export function formatCentsToPoints(cents: bigint): string {
  return formatScaledIntToDecimal(cents, 2);
}

/**
 * Exact verified reward calculation:
 * points_earned = verified_eligible_weight_kg * applied_points_per_kg
 * Rounded HALF_UP to 2 decimal places.
 */
export function calculateRewardPointsCents(
  eligibleWeightKg: string,
  pointsPerKg: string
): { pointsCents: bigint; pointsFormatted: string } {
  const weightCg = parseDecimalToScaledInt(eligibleWeightKg, 2);
  const rateCp = parseDecimalToScaledInt(pointsPerKg, 2);
  if (weightCg === null || rateCp === null || weightCg <= 0n || rateCp <= 0n) {
    return { pointsCents: 0n, pointsFormatted: '0.00' };
  }
  const rawTenThousandths = weightCg * rateCp;
  const roundedCents = (rawTenThousandths + 50n) / 100n; // HALF_UP
  return {
    pointsCents: roundedCents,
    pointsFormatted: formatCentsToPoints(roundedCents),
  };
}

/**
 * Calculate estimated payout value from points (2dp) and conversion rate (4dp).
 */
export function calculateEstimatedPayoutValue(
  pointsCents: bigint,
  conversionRate4dp: string
): { amountFormatted: string; wholeSats: number } {
  const rateScaled = parseDecimalToScaledInt(conversionRate4dp, 4) ?? 0n;
  if (pointsCents <= 0n || rateScaled <= 0n) {
    return { amountFormatted: '0.00', wholeSats: 0 };
  }
  // pointsCents (10^2) * rateScaled (10^4) = 10^6 -> divide by 10^4 for 2dp (HALF_UP)
  const raw = pointsCents * rateScaled;
  const valueCents = (raw + 5000n) / 10000n;
  const wholeSats = Number((valueCents + 50n) / 100n);
  return {
    amountFormatted: formatScaledIntToDecimal(valueCents, 2),
    wholeSats,
  };
}

export function generateScopedReference(prefix: string): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${y}${m}${d}-${suffix}`;
}

export const ALLOWED_REDEMPTION_TRANSITIONS: Record<RedemptionStatus, RedemptionStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PROCESSING', 'PAID', 'REJECTED'],
  PROCESSING: ['PAID', 'FAILED'],
  PAID: [],
  REJECTED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionRedemptionStatus(
  from: RedemptionStatus,
  to: RedemptionStatus
): boolean {
  return ALLOWED_REDEMPTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export const ALLOWED_REDEMPTION_METHODS = new Set<RedemptionMethod>([
  'BITCOIN_LIGHTNING',
  'BANK_TRANSFER',
  'AIRTIME',
  'MOBILE_DATA',
  'CAMPUS_VOUCHER',
]);

const ALLOWED_NETWORKS = new Set(['MTN', 'Airtel', 'Glo', '9mobile']);

export interface ValidatedRedemptionDestination {
  summary: string;
  details: Record<string, string>;
}

export function validateRedemptionDestination(
  method: RedemptionMethod,
  rawDetails: Record<string, unknown>
): { ok: true; value: ValidatedRedemptionDestination } | { ok: false; error: string } {
  const cleanStr = (v: unknown, maxLen = 200) =>
    typeof v === 'string' ? v.trim().slice(0, maxLen) : '';

  switch (method) {
    case 'BITCOIN_LIGHTNING': {
      const destination = cleanStr(rawDetails.lightningDestination, 500);
      const isLightningAddress = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(
        destination
      );
      const isBolt11 = /^ln(bc|tb|bcrt)[0-9a-zA-Z]{20,}$/i.test(destination);
      if (!isLightningAddress && !isBolt11) {
        return {
          ok: false,
          error:
            'Enter a valid Lightning Address (e.g. name@wallet.example) or BOLT11 invoice (lnbc... / lntb...).',
        };
      }
      const summary = isBolt11
        ? `BOLT11 Invoice (${destination.slice(0, 14)}...${destination.slice(-6)})`
        : destination;
      return {
        ok: true,
        value: {
          summary,
          details: {
            lightningDestination: destination,
            destinationType: isBolt11 ? 'BOLT11_INVOICE' : 'LIGHTNING_ADDRESS',
          },
        },
      };
    }

    case 'BANK_TRANSFER': {
      const bankName = cleanStr(rawDetails.bankName, 100);
      const accountNumber = cleanStr(rawDetails.accountNumber, 20).replace(/\s+/g, '');
      const accountName = cleanStr(rawDetails.accountName, 120);
      if (bankName.length < 2) {
        return { ok: false, error: 'Please enter the destination bank name.' };
      }
      if (!/^\d{10}$/.test(accountNumber)) {
        return { ok: false, error: 'Nigerian bank account numbers must be exactly 10 digits.' };
      }
      if (accountName.length < 2) {
        return { ok: false, error: 'Please enter the bank account holder name.' };
      }
      const maskedAcct = `******${accountNumber.slice(-4)}`;
      return {
        ok: true,
        value: {
          summary: `${bankName} · ${maskedAcct} (${accountName})`,
          details: { bankName, accountNumber, accountName },
        },
      };
    }

    case 'AIRTIME':
    case 'MOBILE_DATA': {
      const network = cleanStr(rawDetails.network, 40);
      const phoneNumber = cleanStr(rawDetails.phoneNumber, 25).replace(/\s+/g, '');
      const bundleNote = cleanStr(rawDetails.bundleNote, 120);
      if (!ALLOWED_NETWORKS.has(network)) {
        return { ok: false, error: 'Select a supported mobile network (MTN, Airtel, Glo, 9mobile).' };
      }
      if (!/^(\+?234|0)[789]\d{9}$/.test(phoneNumber)) {
        return {
          ok: false,
          error: 'Enter a valid Nigerian phone number (e.g. 08012345678 or +2348012345678).',
        };
      }
      const summary =
        method === 'MOBILE_DATA' && bundleNote
          ? `${network} Data · ${phoneNumber} (${bundleNote})`
          : `${network} ${method === 'AIRTIME' ? 'Airtime' : 'Data'} · ${phoneNumber}`;
      return {
        ok: true,
        value: {
          summary,
          details: {
            network,
            phoneNumber,
            ...(bundleNote ? { bundleNote } : {}),
          },
        },
      };
    }

    case 'CAMPUS_VOUCHER': {
      const voucherCategory = cleanStr(rawDetails.voucherCategory, 120);
      const recipientIdentifier = cleanStr(rawDetails.recipientIdentifier, 120);
      if (voucherCategory.length < 3) {
        return { ok: false, error: 'Select a campus voucher category.' };
      }
      const summary = recipientIdentifier
        ? `${voucherCategory} (${recipientIdentifier})`
        : voucherCategory;
      return {
        ok: true,
        value: {
          summary,
          details: {
            voucherCategory,
            ...(recipientIdentifier ? { recipientIdentifier } : {}),
          },
        },
      };
    }
  }
}

/**
 * Neutralize spreadsheet formula injection (=, +, -, @, tab, CR) and safely quote CSV cells.
 */
export function escapeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '""';
  }
  let text = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildCsvDocument(headers: string[], rows: Array<Array<unknown>>): string {
  const headerLine = headers.map((h) => escapeCsvCell(h)).join(',');
  const dataLines = rows.map((r) => r.map((cell) => escapeCsvCell(cell)).join(','));
  return [headerLine, ...dataLines].join('\n');
}
