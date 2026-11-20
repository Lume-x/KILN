import crypto from 'node:crypto';
import net from 'node:net';

const ALGORITHM = 'aes-256-gcm';

let ephemeralFallbackKey: Buffer | null = null;
let warnedMissingSecret = false;

function getVaultKey(): Buffer {
  const rawSecret = process.env.KILN_SECRET_KEY || process.env.SESSION_SECRET;
  if (rawSecret && rawSecret.trim().length >= 16) {
    return crypto.createHash('sha256').update(rawSecret.trim()).digest();
  }
  if (!ephemeralFallbackKey) {
    ephemeralFallbackKey = crypto.randomBytes(32);
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.warn(
        '[KILN Security] KILN_SECRET_KEY or SESSION_SECRET (>=16 chars) is not set; using an ephemeral in-memory vault key for this process.'
      );
    }
  }
  return ephemeralFallbackKey;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getVaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Encrypted credential format is invalid.');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getVaultKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export interface ParsedNwcMetadata {
  walletPubkeyHex: string;
  walletPubkeyPreview: string;
  relayUrl: string;
  relayHost: string;
  hasSecret: boolean;
}

function isDisallowedRelayHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !lower ||
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const octets = lower.split('.').map(Number);
    const [a, b] = octets;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }
  if (ipVersion === 6) {
    if (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validates a Nostr Wallet Connect (NIP-47) connection URI without leaking the secret.
 * Format: nostr+walletconnect://<64-hex-pubkey>?relay=wss://...&secret=<64-hex-secret>
 */
export function parseAndValidateNwcUri(
  rawUri: unknown
): { ok: true; value: ParsedNwcMetadata; normalizedUri: string } | { ok: false; error: string } {
  if (typeof rawUri !== 'string' || !rawUri.trim()) {
    return { ok: false, error: 'Please provide a Nostr Wallet Connect (nostr+walletconnect://) URI.' };
  }
  const trimmed = rawUri.trim();
  if (!trimmed.startsWith('nostr+walletconnect://')) {
    return {
      ok: false,
      error: 'NWC URI must begin with nostr+walletconnect://',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.replace(/^nostr\+walletconnect:\/\//, 'https://'));
  } catch {
    return { ok: false, error: 'NWC URI could not be parsed. Verify the connection string format.' };
  }

  const walletPubkeyHex = parsed.hostname.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(walletPubkeyHex)) {
    return {
      ok: false,
      error: 'NWC wallet public key must be a valid 64-character lowercase hexadecimal string.',
    };
  }

  const relayParam = parsed.searchParams.get('relay')?.trim() ?? '';
  if (!relayParam || !relayParam.startsWith('wss://')) {
    return {
      ok: false,
      error: 'NWC URI must include a secure wss:// relay parameter.',
    };
  }

  let relayHost: string;
  try {
    const relayParsed = new URL(relayParam);
    if (relayParsed.protocol !== 'wss:' || isDisallowedRelayHostname(relayParsed.hostname)) {
      return {
        ok: false,
        error: 'NWC relay URL must point to a public wss:// host (private or loopback addresses are not permitted).',
      };
    }
    relayHost = relayParsed.host;
  } catch {
    return { ok: false, error: 'NWC relay URL is invalid.' };
  }

  const secretParam = parsed.searchParams.get('secret')?.trim() ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(secretParam)) {
    return {
      ok: false,
      error: 'NWC URI must include a valid 64-character hexadecimal secret parameter.',
    };
  }

  const walletPubkeyPreview = `${walletPubkeyHex.slice(0, 8)}...${walletPubkeyHex.slice(-6)}`;

  return {
    ok: true,
    normalizedUri: trimmed,
    value: {
      walletPubkeyHex,
      walletPubkeyPreview,
      relayUrl: relayParam,
      relayHost,
      hasSecret: true,
    },
  };
}
