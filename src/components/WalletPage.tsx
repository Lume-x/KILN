import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, KeyRound, RefreshCw, Wallet, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  AppRoute,
  NotificationPreferencesRecord,
  NotificationRecord,
  RedemptionMethod,
  RedemptionRecord,
  RedemptionSettingsRecord,
  RewardLedgerEntry,
  UserWalletSummary,
} from '../types/kiln';
import {
  LEDGER_TYPE_LABELS,
  REDEMPTION_METHOD_LABELS,
  REDEMPTION_STATUS_META,
  formatDateTime,
} from '../lib/status-labels';

interface WalletPageProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
}

type WalletTab = 'overview' | 'redeem' | 'notifications' | 'connections';

interface NwcConnectionView {
  id: number;
  label: string;
  relayHost: string;
  walletPubkeyPreview: string;
  status: string;
  lastValidatedAt: string | null;
  lastError: string | null;
}

const ALL_METHODS: RedemptionMethod[] = [
  'BITCOIN_LIGHTNING',
  'BANK_TRANSFER',
  'AIRTIME',
  'MOBILE_DATA',
  'LOCAL_VOUCHER',
];

function getDestinationHelper(method: RedemptionMethod): { label: string; placeholder: string } {
  switch (method) {
    case 'BITCOIN_LIGHTNING':
      return {
        label: 'Lightning address or BOLT11 invoice',
        placeholder: 'e.g. ada@getalby.com or lnbc1...',
      };
    case 'BANK_TRANSFER':
      return {
        label: 'Bank name, 10-digit account number & account name',
        placeholder: 'e.g. Access Bank · 0123456789 · Ada Obi',
      };
    case 'AIRTIME':
      return {
        label: 'Nigerian phone number & network',
        placeholder: 'e.g. 08031234567 (MTN)',
      };
    case 'MOBILE_DATA':
      return {
        label: 'Nigerian phone number & network for data bundle',
        placeholder: 'e.g. 08091234567 (Airtel)',
      };
    case 'LOCAL_VOUCHER':
      return {
        label: 'Campus / community pickup location or merchant reference',
        placeholder: 'e.g. FUTO Student Union Bookshop Voucher',
      };
  }
}

export function WalletPage({ onNavigate }: WalletPageProps) {
  const { user, loading: authLoading, authFetch, refreshUser } = useAuth();

  const [tab, setTab] = useState<WalletTab>('overview');
  const [wallet, setWallet] = useState<UserWalletSummary | null>(null);
  const [ledger, setLedger] = useState<RewardLedgerEntry[]>([]);
  const [ledgerFilter, setLedgerFilter] = useState('ALL');
  const [settings, setSettings] = useState<RedemptionSettingsRecord | null>(null);
  const [redemptions, setRedemptions] = useState<RedemptionRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [prefs, setPrefs] = useState<NotificationPreferencesRecord | null>(null);

  // Optional NWC & Nostr state
  const [nwcConnection, setNwcConnection] = useState<NwcConnectionView | null>(null);
  const [lightningMeta, setLightningMeta] = useState<{ enabled: boolean; mode: string }>({
    enabled: false,
    mode: 'DISABLED',
  });
  const [nwcUri, setNwcUri] = useState('');
  const [nwcLabel, setNwcLabel] = useState('My Lightning Wallet');
  const [nostrPubkeyInput, setNostrPubkeyInput] = useState('');
  const [nostrChallenge, setNostrChallenge] = useState<{ nonce: string; expiresAt: string } | null>(
    null
  );

  // Redeem form state
  const [pointsRequested, setPointsRequested] = useState('');
  const [method, setMethod] = useState<RedemptionMethod>('BITCOIN_LIGHTNING');
  const [destinationDetails, setDestinationDetails] = useState('');
  const [expandedRedemptionId, setExpandedRedemptionId] = useState<number | null>(null);

  const [loadingData, setLoadingData] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      onNavigate('/login');
    }
  }, [authLoading, user, onNavigate]);

  const loadWalletWorkspace = useCallback(async () => {
    setLoadingData(true);
    setError(null);
    try {
      const typeQuery = ledgerFilter !== 'ALL' ? `?type=${encodeURIComponent(ledgerFilter)}` : '';
      const [wRes, rRes, nRes, pRes, nwcRes] = await Promise.all([
        authFetch(`/api/wallet${typeQuery}`),
        authFetch('/api/redemptions'),
        authFetch('/api/notifications'),
        authFetch('/api/notifications/preferences'),
        authFetch('/api/integrations/nwc'),
      ]);

      if (!wRes.ok) {
        const d = await wRes.json().catch(() => ({}));
        throw new Error(d.error || 'Could not load reward wallet.');
      }

      const [wData, rData, nData, pData, nwcData] = await Promise.all([
        wRes.json(),
        rRes.ok ? rRes.json() : Promise.resolve({ redemptions: [] }),
        nRes.ok ? nRes.json() : Promise.resolve({ notifications: [], unreadCount: 0 }),
        pRes.ok ? pRes.json() : Promise.resolve({ preferences: null }),
        nwcRes.ok
          ? nwcRes.json()
          : Promise.resolve({ connection: null, lightningEnabled: false, lightningMode: 'DISABLED' }),
      ]);

      setWallet(wData.wallet ?? null);
      setLedger(Array.isArray(wData.transactions) ? wData.transactions : []);
      setSettings(wData.settings ?? null);
      setRedemptions(Array.isArray(rData.redemptions) ? rData.redemptions : []);
      setNotifications(Array.isArray(nData.notifications) ? nData.notifications : []);
      setUnreadCount(Number(nData.unreadCount ?? 0));
      setPrefs(pData.preferences ?? null);
      setNwcConnection(nwcData.connection ?? null);
      setLightningMeta({
        enabled: Boolean(nwcData.lightningEnabled),
        mode: String(nwcData.lightningMode || 'DISABLED'),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load wallet data.');
    } finally {
      setLoadingData(false);
    }
  }, [authFetch, ledgerFilter]);

  useEffect(() => {
    if (user) {
      loadWalletWorkspace();
    }
  }, [user, loadWalletWorkspace]);

  useEffect(() => {
    if (user?.lightningAddress && method === 'BITCOIN_LIGHTNING' && !destinationDetails) {
      setDestinationDetails(user.lightningAddress);
    }
  }, [user, method, destinationDetails]);

  const liveEstimate = useMemo(() => {
    const pts = Number(pointsRequested);
    if (!settings || !Number.isFinite(pts) || pts <= 0) return null;
    const ngn = (pts * Number(settings.pointsToNgnRate || 0)).toFixed(2);
    const sats = Math.round(pts * Number(settings.pointsToSatsRate || 0));
    return { ngn, sats };
  }, [pointsRequested, settings]);

  async function handleSubmitRedemption(e: React.FormEvent) {
    e.preventDefault();
    setBusy('redeem');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/redemptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pointsRequested,
          method,
          destinationDetails,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit redemption request.');
      setPointsRequested('');
      setDestinationDetails('');
      setNotice(
        `Redemption ${data.redemption.referenceCode} submitted. ${data.redemption.pointsRequested} points reserved pending administrator review.`
      );
      await Promise.all([loadWalletWorkspace(), refreshUser()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Redemption submission failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCancelRedemption(redemption: RedemptionRecord) {
    setBusy(`cancel-${redemption.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/redemptions/${redemption.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by participant from wallet' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not cancel redemption.');
      setNotice(
        `Cancelled ${redemption.referenceCode}. ${redemption.pointsRequested} points returned to available balance.`
      );
      await Promise.all([loadWalletWorkspace(), refreshUser()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancellation failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleMarkRead(id: number) {
    await authFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    await Promise.all([loadWalletWorkspace(), refreshUser()]);
  }

  async function handleMarkAllRead() {
    setBusy('read-all');
    try {
      await authFetch('/api/notifications/read-all', { method: 'POST' });
      await Promise.all([loadWalletWorkspace(), refreshUser()]);
    } finally {
      setBusy(null);
    }
  }

  async function handleTogglePref(key: keyof NotificationPreferencesRecord) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await authFetch('/api/notifications/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
  }

  async function handleConnectNwc(e: React.FormEvent) {
    e.preventDefault();
    setBusy('connect-nwc');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/integrations/nwc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nwcUri, label: nwcLabel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not connect NWC wallet.');
      setNwcUri('');
      setNwcConnection(data.connection);
      setNotice('NWC wallet connection encrypted and saved. Secret credentials are never returned.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect NWC wallet.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnectNwc() {
    setBusy('disconnect-nwc');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/integrations/nwc', { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not disconnect NWC wallet.');
      setNwcConnection(null);
      setNotice('Optional NWC wallet connection removed.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleStartNostrChallenge() {
    setBusy('nostr-challenge');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/integrations/nostr/challenge', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start Nostr challenge.');
      setNostrChallenge({ nonce: data.challenge.nonce, expiresAt: data.challenge.expiresAt });
      const win = window as unknown as {
        nostr?: { getPublicKey?: () => Promise<string> };
      };
      if (win.nostr?.getPublicKey) {
        try {
          const pk = await win.nostr.getPublicKey();
          if (pk) setNostrPubkeyInput(pk);
        } catch {
          // User can paste pubkey manually if NIP-07 extension denied
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create Nostr challenge.');
    } finally {
      setBusy(null);
    }
  }

  async function handleLinkNostr(e: React.FormEvent) {
    e.preventDefault();
    setBusy('nostr-link');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/integrations/nostr/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pubkeyHex: nostrPubkeyInput,
          challengeNonce: nostrChallenge?.nonce,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not link Nostr public key.');
      setNostrPubkeyInput('');
      setNostrChallenge(null);
      setNotice('Nostr public key linked to your KILN profile.');
      await refreshUser();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not link Nostr identity.');
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlinkNostr() {
    setBusy('nostr-unlink');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/integrations/nostr/link', { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not unlink Nostr key.');
      setNotice('Nostr public key removed from your profile.');
      await refreshUser();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unlink failed.');
    } finally {
      setBusy(null);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <p className="text-sm text-[#59605B]">Loading your KILN reward wallet...</p>
      </main>
    );
  }

  const w = wallet ?? user.wallet;
  const destHelp = getDestinationHelper(method);
  const enabledMethods = settings?.enabledMethods ?? ALL_METHODS;

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#DAD7CE]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[#59605B]">
            Verified Rewards &amp; Ledger
          </p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
            Reward Wallet &amp; Redemptions
          </h1>
          <p className="mt-1 text-sm text-[#59605B]">
            Points are credited strictly after physical weighing and administrator verification, or
            upon completing Learn &amp; Earn quizzes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadWalletWorkspace()}
            className="min-h-[44px] px-3.5 py-2 text-sm font-medium text-[#171B19] border border-[#C9C5BA] bg-white hover:bg-[#EFECE4] rounded-sm inline-flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/collections')}
            className="min-h-[44px] px-4 py-2 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
          >
            Submit Recyclables
          </button>
        </div>
      </div>

      {/* Wallet KPI Strip */}
      <section
        aria-label="Wallet balances"
        className="mt-6 grid grid-cols-2 lg:grid-cols-4 border border-[#DAD7CE] bg-white divide-y sm:divide-y-0 sm:divide-x divide-[#E5E2D9] rounded-sm"
      >
        <div className="p-5">
          <p className="text-xs font-medium text-[#59605B]">Available Balance</p>
          <p className="mt-1.5 font-mono text-2xl sm:text-3xl font-semibold text-[#17372D] tabular-nums">
            {w.availablePoints} <span className="text-sm font-normal text-[#59605B]">pts</span>
          </p>
          {settings && (
            <p className="mt-1 text-xs text-[#59605B] font-mono tabular-nums">
              ≈ ₦{(Number(w.availablePoints) * Number(settings.pointsToNgnRate)).toFixed(2)} ·{' '}
              {Math.round(Number(w.availablePoints) * Number(settings.pointsToSatsRate))} sats
              {settings.isDemoRates ? ' [DEMO]' : ''}
            </p>
          )}
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-[#59605B]">Reserved / Pending</p>
          <p className="mt-1.5 font-mono text-2xl sm:text-3xl font-semibold text-[#8A4E11] tabular-nums">
            {w.pendingRedemptionPoints}{' '}
            <span className="text-sm font-normal text-[#59605B]">pts</span>
          </p>
          <p className="mt-1 text-xs text-[#59605B]">Held for open redemption requests</p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-[#59605B]">Total Verified Earned</p>
          <p className="mt-1.5 font-mono text-2xl sm:text-3xl font-semibold text-[#171B19] tabular-nums">
            {w.totalEarnedPoints} <span className="text-sm font-normal text-[#59605B]">pts</span>
          </p>
          <p className="mt-1 text-xs text-[#59605B]">Collections + Learn &amp; Earn</p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-[#59605B]">Total Paid Out</p>
          <p className="mt-1.5 font-mono text-2xl sm:text-3xl font-semibold text-[#171B19] tabular-nums">
            {w.totalRedeemedPoints} <span className="text-sm font-normal text-[#59605B]">pts</span>
          </p>
          <p className="mt-1 text-xs text-[#59605B]">Completed redemptions</p>
        </div>
      </section>

      {/* Alerts */}
      {error && (
        <div
          role="alert"
          className="mt-5 p-3.5 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mt-5 p-3.5 text-sm text-[#17372D] bg-[#EEF4F0] border border-[#B7CEC0] rounded-sm flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div className="mt-6 flex flex-wrap gap-2 border-b border-[#DAD7CE] pb-3">
        {(
          [
            { id: 'overview', label: 'Ledger & Redemptions', icon: Wallet },
            { id: 'redeem', label: 'Redeem Points', icon: Zap },
            {
              id: 'notifications',
              label: `Notifications${unreadCount > 0 ? ` (${unreadCount})` : ''}`,
              icon: Bell,
            },
            { id: 'connections', label: 'Optional Lightning & Nostr', icon: KeyRound },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`min-h-[44px] px-4 py-2 text-sm font-medium rounded-sm inline-flex items-center gap-2 cursor-pointer transition-colors ${
                active
                  ? 'bg-[#17372D] text-[#F7F6F2]'
                  : 'bg-white border border-[#DAD7CE] text-[#3F4541] hover:bg-[#EFECE4]'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: LEDGER & REDEMPTION TRACKING */}
      {tab === 'overview' && (
        <div className="mt-8 space-y-10">
          {/* Active & Historical Redemptions */}
          <section className="bg-white border border-[#DAD7CE] rounded-sm">
            <div className="p-5 border-b border-[#E5E2D9] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-[#171B19]">
                  My Redemption Requests
                </h2>
                <p className="text-xs text-[#59605B] mt-0.5">
                  Reserved points return automatically if a request is cancelled, rejected, or fails.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTab('redeem')}
                className="min-h-[40px] px-4 py-2 text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer self-start sm:self-auto"
              >
                New Redemption Request
              </button>
            </div>

            {loadingData ? (
              <p className="p-6 text-sm text-[#59605B]">Loading redemption records...</p>
            ) : redemptions.length === 0 ? (
              <div className="p-6 text-sm text-[#59605B]">
                You have not submitted any redemption requests yet. Once you accumulate at least{' '}
                <strong className="text-[#171B19]">
                  {settings?.minRedemptionPoints ?? '50.00'} points
                </strong>
                , you can request a payout.
              </div>
            ) : (
              <div className="divide-y divide-[#E5E2D9]">
                {redemptions.map((r) => {
                  const meta = REDEMPTION_STATUS_META[r.status] ?? {
                    label: r.status,
                    textClass: 'text-[#3F4541]',
                  };
                  const expanded = expandedRedemptionId === r.id;
                  return (
                    <div key={r.id} className="p-5">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="font-mono font-semibold text-[#171B19]">
                              {r.referenceCode}
                            </span>
                            <span className={`font-semibold ${meta.textClass}`}>{meta.label}</span>
                            {r.isSimulatedPayout && (
                              <span className="font-mono text-xs text-[#8A4E11] border border-[#D8B98E] bg-[#FDF8EE] px-1.5 py-0.5 rounded-sm">
                                SIMULATED PAYMENT (DEMO)
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-[#3F4541]">
                            <strong className="font-mono tabular-nums">
                              {r.pointsRequested} pts
                            </strong>{' '}
                            via {REDEMPTION_METHOD_LABELS[r.method]} · Destination:{' '}
                            <span className="font-mono text-xs">{r.destinationMasked}</span>
                          </p>
                          <p className="text-xs text-[#59605B]">
                            Requested {formatDateTime(r.createdAt)}
                            {r.estimatedNgnValue ? ` · Est. ₦${r.estimatedNgnValue}` : ''}
                            {r.estimatedSatsValue ? ` / ${r.estimatedSatsValue} sats` : ''}
                            {r.payoutReference ? ` · Ref: ${r.payoutReference}` : ''}
                          </p>
                          {r.reviewNote && (
                            <p className="text-xs text-[#59605B]">Note: {r.reviewNote}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setExpandedRedemptionId(expanded ? null : r.id)}
                            className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-[#171B19] border border-[#C9C5BA] bg-[#F7F6F2] hover:bg-[#EFECE4] rounded-sm cursor-pointer"
                          >
                            {expanded ? 'Hide Timeline' : 'Status History'}
                          </button>
                          {r.status === 'PENDING' && (
                            <button
                              type="button"
                              disabled={busy === `cancel-${r.id}`}
                              onClick={() => handleCancelRedemption(r)}
                              className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-[#991B1B] border border-[#E6B8B0] bg-[#FDF2F0] hover:bg-[#FCE5E0] rounded-sm cursor-pointer"
                            >
                              {busy === `cancel-${r.id}` ? 'Cancelling...' : 'Cancel & Refund'}
                            </button>
                          )}
                        </div>
                      </div>

                      {expanded && r.history.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-[#E5E2D9] space-y-1.5 text-xs text-[#59605B]">
                          {r.history.map((h) => (
                            <div key={h.id} className="flex flex-wrap justify-between gap-2">
                              <span>
                                <strong className="text-[#171B19]">
                                  {h.fromStatus ? `${h.fromStatus} → ${h.toStatus}` : h.toStatus}
                                </strong>{' '}
                                by {h.actorName}
                                {h.note ? ` — ${h.note}` : ''}
                              </span>
                              <span className="font-mono">{formatDateTime(h.createdAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Immutable Reward Ledger */}
          <section className="bg-white border border-[#DAD7CE] rounded-sm">
            <div className="p-5 border-b border-[#E5E2D9] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-[#171B19]">
                  Immutable Reward Ledger
                </h2>
                <p className="text-xs text-[#59605B] mt-0.5">
                  Every verified collection reward, learning bonus, redemption hold, and reversal is
                  recorded permanently.
                </p>
              </div>
              <select
                aria-label="Filter ledger by transaction type"
                value={ledgerFilter}
                onChange={(e) => setLedgerFilter(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
              >
                <option value="ALL">All Transaction Types</option>
                <option value="COLLECTION_REWARD">Collection Rewards</option>
                <option value="LEARNING_BONUS">Learn &amp; Earn Bonuses</option>
                <option value="REDEMPTION">Redemption Holds</option>
                <option value="REVERSAL">Reversals</option>
                <option value="ADMIN_ADJUSTMENT">Admin Adjustments</option>
              </select>
            </div>

            {loadingData ? (
              <p className="p-6 text-sm text-[#59605B]">Loading ledger transactions...</p>
            ) : ledger.length === 0 ? (
              <p className="p-6 text-sm text-[#59605B]">
                No reward ledger entries recorded yet. Submit recyclable materials or complete a
                Learn &amp; Earn module to earn verified points.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#DAD7CE] bg-[#F7F6F2] text-xs uppercase tracking-wide text-[#59605B]">
                      <th className="py-3 px-4 font-semibold">Reference</th>
                      <th className="py-3 px-4 font-semibold">Type &amp; Description</th>
                      <th className="py-3 px-4 font-semibold text-right">Amount</th>
                      <th className="py-3 px-4 font-semibold text-right">Balance After</th>
                      <th className="py-3 px-4 font-semibold">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E2D9]">
                    {ledger.map((tx) => {
                      const isCredit = tx.direction === 'CREDIT';
                      return (
                        <tr key={tx.id} className="hover:bg-[#FAF9F5]">
                          <td className="py-3 px-4 font-mono text-xs text-[#171B19] whitespace-nowrap">
                            {tx.referenceCode}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-medium text-[#171B19]">
                              {LEDGER_TYPE_LABELS[tx.transactionType] ?? tx.transactionType}
                            </p>
                            <p className="text-xs text-[#59605B]">{tx.description}</p>
                          </td>
                          <td
                            className={`py-3 px-4 font-mono font-semibold text-right tabular-nums whitespace-nowrap ${
                              isCredit ? 'text-[#14532D]' : 'text-[#991B1B]'
                            }`}
                          >
                            {isCredit ? `+${tx.amountPoints}` : `-${tx.amountPoints}`} pts
                          </td>
                          <td className="py-3 px-4 font-mono text-right text-[#3F4541] tabular-nums whitespace-nowrap">
                            {tx.balanceAfter} pts
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-[#59605B] whitespace-nowrap">
                            {formatDateTime(tx.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: REDEEM POINTS */}
      {tab === 'redeem' && (
        <section className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold text-[#171B19]">
              Request Reward Redemption
            </h2>
            <p className="mt-1 text-sm text-[#59605B]">
              Minimum threshold:{' '}
              <strong className="font-mono text-[#171B19]">
                {settings?.minRedemptionPoints ?? '50.00'} pts
              </strong>
              . Points are reserved immediately to prevent double-spending while your payout is
              reviewed.
            </p>

            <form onSubmit={handleSubmitRedemption} className="mt-6 space-y-5">
              <div>
                <label htmlFor="rd-method" className="block text-sm font-medium text-[#171B19]">
                  Redemption method
                </label>
                <select
                  id="rd-method"
                  value={method}
                  onChange={(e) => {
                    setMethod(e.target.value as RedemptionMethod);
                    setDestinationDetails('');
                  }}
                  className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                >
                  {ALL_METHODS.map((m) => (
                    <option key={m} value={m} disabled={!enabledMethods.includes(m)}>
                      {REDEMPTION_METHOD_LABELS[m]}
                      {!enabledMethods.includes(m) ? ' (Currently Disabled)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="rd-points" className="block text-sm font-medium text-[#171B19]">
                  Points to redeem (Available: {w.availablePoints} pts)
                </label>
                <input
                  id="rd-points"
                  type="number"
                  step="0.01"
                  min={settings?.minRedemptionPoints ?? '1'}
                  max={w.availablePoints}
                  required
                  value={pointsRequested}
                  onChange={(e) => setPointsRequested(e.target.value)}
                  placeholder={`At least ${settings?.minRedemptionPoints ?? '50.00'}`}
                  className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                />
                {liveEstimate && (
                  <p className="mt-1.5 text-xs text-[#17372D] font-mono tabular-nums">
                    Estimated value{settings?.isDemoRates ? ' (DEMO RATE)' : ''}:{' '}
                    {method === 'BITCOIN_LIGHTNING'
                      ? `${liveEstimate.sats} sats`
                      : `₦${liveEstimate.ngn}`}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="rd-dest" className="block text-sm font-medium text-[#171B19]">
                  {destHelp.label}
                </label>
                <input
                  id="rd-dest"
                  type="text"
                  required
                  value={destinationDetails}
                  onChange={(e) => setDestinationDetails(e.target.value)}
                  placeholder={destHelp.placeholder}
                  className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                />
              </div>

              <button
                type="submit"
                disabled={busy === 'redeem'}
                className="min-h-[44px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm cursor-pointer"
              >
                {busy === 'redeem' ? 'Submitting Request...' : 'Submit Redemption Request'}
              </button>
            </form>
          </div>

          <aside className="lg:col-span-5 bg-[#EFECE4] border border-[#DAD7CE] rounded-sm p-6 space-y-4">
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              How Redemption Safety Works
            </h3>
            <ul className="space-y-2.5 text-sm text-[#3F4541]">
              <li>
                <strong>1. Balance Reservation:</strong> Submitting a request atomically moves
                points from Available to Pending so duplicate submissions cannot overdraw your
                wallet.
              </li>
              <li>
                <strong>2. Administrator Verification:</strong> Payouts are reviewed by the KILN
                operations team before settlement.
              </li>
              <li>
                <strong>3. Automatic Reversal:</strong> If you cancel a pending request or if a
                payout fails or is rejected, your points are returned automatically via an immutable
                reversal entry.
              </li>
              <li>
                <strong>4. Optional Bitcoin Lightning:</strong> Lightning payouts run in{' '}
                <strong className="font-mono">{lightningMeta.mode}</strong> mode. Demo payouts are
                always clearly labelled <span className="font-mono">SIMULATED PAYMENT</span>.
              </li>
            </ul>
          </aside>
        </section>
      )}

      {/* TAB 3: NOTIFICATIONS & PREFERENCES */}
      {tab === 'notifications' && (
        <section className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 bg-white border border-[#DAD7CE] rounded-sm">
            <div className="p-5 border-b border-[#E5E2D9] flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-[#171B19]">
                  Activity Notifications
                </h2>
                <p className="text-xs text-[#59605B]">
                  {unreadCount} unread notification{unreadCount === 1 ? '' : 's'}
                </p>
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={busy === 'read-all'}
                  onClick={handleMarkAllRead}
                  className="min-h-[40px] px-3.5 py-1.5 text-xs font-medium text-[#17372D] border border-[#17372D] rounded-sm hover:bg-[#EEF4F0] cursor-pointer"
                >
                  Mark All Read
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className="p-6 text-sm text-[#59605B]">
                No notifications yet. Updates on collections, verifications, rewards, and
                redemptions will appear here.
              </p>
            ) : (
              <div className="divide-y divide-[#E5E2D9]">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                      n.isRead ? 'bg-white' : 'bg-[#FAF9F2]'
                    }`}
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[#171B19]">
                        {n.title}
                        {!n.isRead && (
                          <span className="ml-2 text-xs font-mono text-[#8A4E11]">[UNREAD]</span>
                        )}
                      </p>
                      <p className="text-sm text-[#3F4541]">{n.message}</p>
                      <p className="text-xs font-mono text-[#59605B]">
                        {formatDateTime(n.createdAt)}
                      </p>
                    </div>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(n.id)}
                        className="min-h-[36px] px-3 py-1 text-xs font-medium text-[#17372D] border border-[#C9C5BA] rounded-sm hover:bg-[#EFECE4] shrink-0 cursor-pointer"
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-4 bg-white border border-[#DAD7CE] rounded-sm p-6 self-start">
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Notification Preferences
            </h3>
            <p className="mt-1 text-xs text-[#59605B]">
              Choose which in-app updates KILN records for your account.
            </p>
            {prefs && (
              <div className="mt-5 space-y-3 text-sm">
                {(
                  [
                    ['collectionUpdates', 'Collection status & agent assignment'],
                    ['verificationRewards', 'Weight verification & reward credits'],
                    ['redemptionUpdates', 'Redemption review & payout status'],
                    ['learningUpdates', 'Learn & Earn quiz completion bonuses'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-start gap-3 p-2.5 border border-[#E5E2D9] rounded-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={prefs[key]}
                      onChange={() => handleTogglePref(key)}
                      className="mt-0.5 h-4 w-4 accent-[#17372D]"
                    />
                    <span className="text-[#171B19]">{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 4: OPTIONAL LIGHTNING NWC & NOSTR IDENTITY */}
      {tab === 'connections' && (
        <section className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* NWC Wallet */}
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-6">
            <h2 className="font-display text-xl font-semibold text-[#171B19]">
              Optional Nostr Wallet Connect (NWC)
            </h2>
            <p className="mt-1 text-sm text-[#59605B]">
              Connect a compatible Bitcoin Lightning wallet via NIP-47. Your connection secret is
              encrypted server-side with AES-256-GCM and never returned to the browser. Core
              recycling works without this.
            </p>
            <p className="mt-2 text-xs font-mono text-[#59605B]">
              Platform Lightning Status: {lightningMeta.enabled ? lightningMeta.mode : 'DISABLED'}
            </p>

            {nwcConnection ? (
              <div className="mt-5 p-4 bg-[#EEF4F0] border border-[#B7CEC0] rounded-sm space-y-2 text-sm">
                <p className="font-semibold text-[#17372D]">
                  Connected: {nwcConnection.label} ({nwcConnection.status})
                </p>
                <p className="text-xs font-mono text-[#3F4541]">
                  Relay: {nwcConnection.relayHost}
                </p>
                <p className="text-xs font-mono text-[#3F4541]">
                  Wallet Pubkey: {nwcConnection.walletPubkeyPreview}
                </p>
                <button
                  type="button"
                  disabled={busy === 'disconnect-nwc'}
                  onClick={handleDisconnectNwc}
                  className="mt-2 min-h-[40px] px-4 py-1.5 text-xs font-semibold text-[#991B1B] border border-[#E6B8B0] bg-white hover:bg-[#FDF2F0] rounded-sm cursor-pointer"
                >
                  {busy === 'disconnect-nwc' ? 'Disconnecting...' : 'Disconnect Wallet'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleConnectNwc} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="nwc-label" className="block text-sm font-medium text-[#171B19]">
                    Wallet label
                  </label>
                  <input
                    id="nwc-label"
                    type="text"
                    value={nwcLabel}
                    onChange={(e) => setNwcLabel(e.target.value)}
                    className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  />
                </div>
                <div>
                  <label htmlFor="nwc-uri" className="block text-sm font-medium text-[#171B19]">
                    NWC connection URI
                  </label>
                  <input
                    id="nwc-uri"
                    type="password"
                    required
                    value={nwcUri}
                    onChange={(e) => setNwcUri(e.target.value)}
                    placeholder="nostr+walletconnect://<pubkey>?relay=wss://...&secret=..."
                    className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy === 'connect-nwc'}
                  className="min-h-[44px] px-5 py-2 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
                >
                  {busy === 'connect-nwc' ? 'Validating & Encrypting...' : 'Connect NWC Wallet'}
                </button>
              </form>
            )}
          </div>

          {/* Optional Nostr Identity */}
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-6">
            <h2 className="font-display text-xl font-semibold text-[#171B19]">
              Optional Nostr Public Identity
            </h2>
            <p className="mt-1 text-sm text-[#59605B]">
              Optionally bind a 64-character Nostr public key (hex) to your KILN profile. Public
              Proof-of-Recycling records never expose your name, email, phone, or street address.
            </p>

            {user.nostrPubkey ? (
              <div className="mt-5 p-4 bg-[#EEF4F0] border border-[#B7CEC0] rounded-sm space-y-2 text-sm">
                <p className="font-semibold text-[#17372D]">Nostr Public Key Linked</p>
                <p className="text-xs font-mono break-all text-[#3F4541]">{user.nostrPubkey}</p>
                <button
                  type="button"
                  disabled={busy === 'nostr-unlink'}
                  onClick={handleUnlinkNostr}
                  className="mt-2 min-h-[40px] px-4 py-1.5 text-xs font-semibold text-[#991B1B] border border-[#E6B8B0] bg-white hover:bg-[#FDF2F0] rounded-sm cursor-pointer"
                >
                  {busy === 'nostr-unlink' ? 'Removing...' : 'Unlink Public Key'}
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <button
                  type="button"
                  disabled={busy === 'nostr-challenge'}
                  onClick={handleStartNostrChallenge}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#17372D] border border-[#17372D] bg-[#F7F6F2] hover:bg-[#EFECE4] rounded-sm cursor-pointer"
                >
                  {busy === 'nostr-challenge'
                    ? 'Generating Challenge...'
                    : 'Generate NIP-07 Challenge Nonce'}
                </button>

                {nostrChallenge && (
                  <div className="p-3 bg-[#F7F6F2] border border-[#DAD7CE] rounded-sm text-xs font-mono break-all">
                    Challenge Nonce: {nostrChallenge.nonce}
                  </div>
                )}

                <form onSubmit={handleLinkNostr} className="space-y-3">
                  <div>
                    <label
                      htmlFor="nostr-pubkey"
                      className="block text-sm font-medium text-[#171B19]"
                    >
                      Nostr Public Key (64-char hex)
                    </label>
                    <input
                      id="nostr-pubkey"
                      type="text"
                      required
                      value={nostrPubkeyInput}
                      onChange={(e) => setNostrPubkeyInput(e.target.value)}
                      placeholder="64 hexadecimal characters..."
                      className="mt-1 w-full min-h-[44px] px-3 py-2 text-xs font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy === 'nostr-link'}
                    className="min-h-[44px] px-5 py-2 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
                  >
                    {busy === 'nostr-link' ? 'Linking...' : 'Link Nostr Identity'}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
