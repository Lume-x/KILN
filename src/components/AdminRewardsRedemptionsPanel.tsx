import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  MaterialCategory,
  RedemptionMethod,
  RedemptionRecord,
  RedemptionSettingsRecord,
  RewardLedgerEntry,
} from '../types/kiln';
import {
  LEDGER_TYPE_LABELS,
  REDEMPTION_METHOD_LABELS,
  REDEMPTION_STATUS_META,
  formatDateTime,
} from '../lib/status-labels';

interface AdminRewardRateRow {
  id: number;
  materialCategoryId: number;
  materialName: string;
  pointsPerKg: string;
  isActive: boolean;
  isDemo: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string;
  createdAt: string;
}

const ALL_METHODS: RedemptionMethod[] = [
  'BITCOIN_LIGHTNING',
  'BANK_TRANSFER',
  'AIRTIME',
  'MOBILE_DATA',
  'LOCAL_VOUCHER',
];

export function AdminRewardsRedemptionsPanel({
  materials,
}: {
  materials: MaterialCategory[];
}) {
  const { authFetch } = useAuth();
  const [subTab, setSubTab] = useState<'redemptions' | 'rates' | 'settings' | 'ledger'>('redemptions');
  const [redemptions, setRedemptions] = useState<RedemptionRecord[]>([]);
  const [rates, setRates] = useState<AdminRewardRateRow[]>([]);
  const [settings, setSettings] = useState<RedemptionSettingsRecord | null>(null);
  const [ledger, setLedger] = useState<RewardLedgerEntry[]>([]);
  const [usersList, setUsersList] = useState<Array<{ id: number; fullName: string; email: string }>>([]);

  // Filters
  const [rdStatusFilter, setRdStatusFilter] = useState('ALL');
  const [rdMethodFilter, setRdMethodFilter] = useState('ALL');
  const [rdSearch, setRdSearch] = useState('');
  const [payoutRefs, setPayoutRefs] = useState<Record<number, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  // New rate form
  const [rateMatId, setRateMatId] = useState('');
  const [ratePoints, setRatePoints] = useState('');
  const [rateReason, setRateReason] = useState('');
  const [rateIsDemo, setRateIsDemo] = useState(true);

  // Settings form
  const [minPts, setMinPts] = useState('50.00');
  const [ngnRate, setNgnRate] = useState('1.0000');
  const [satsRate, setSatsRate] = useState('10.0000');
  const [enabledMethods, setEnabledMethods] = useState<RedemptionMethod[]>(ALL_METHODS);
  const [isDemoRates, setIsDemoRates] = useState(true);

  // Manual adjustment form
  const [adjUserId, setAdjUserId] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (rdStatusFilter !== 'ALL') qs.set('status', rdStatusFilter);
      if (rdMethodFilter !== 'ALL') qs.set('method', rdMethodFilter);
      if (rdSearch.trim()) qs.set('search', rdSearch.trim());

      const [rdRes, rateRes, setRes, ledRes, usrRes] = await Promise.all([
        authFetch(`/api/admin/redemptions?${qs.toString()}`),
        authFetch('/api/admin/reward-rates'),
        authFetch('/api/admin/redemption-settings'),
        authFetch('/api/admin/ledger?limit=80'),
        authFetch('/api/admin/users'),
      ]);

      const [rdData, rateData, setData, ledData, usrData] = await Promise.all([
        rdRes.ok ? rdRes.json() : Promise.resolve({ redemptions: [] }),
        rateRes.ok ? rateRes.json() : Promise.resolve({ history: [] }),
        setRes.ok ? setRes.json() : Promise.resolve({ settings: null }),
        ledRes.ok ? ledRes.json() : Promise.resolve({ transactions: [] }),
        usrRes.ok ? usrRes.json() : Promise.resolve({ users: [] }),
      ]);

      setRedemptions(Array.isArray(rdData.redemptions) ? rdData.redemptions : []);
      setRates(Array.isArray(rateData.history) ? rateData.history : []);
      if (setData.settings) {
        setSettings(setData.settings);
        setMinPts(setData.settings.minRedemptionPoints);
        setNgnRate(setData.settings.pointsToNgnRate);
        setSatsRate(setData.settings.pointsToSatsRate);
        setEnabledMethods(setData.settings.enabledMethods);
        setIsDemoRates(Boolean(setData.settings.isDemoRates));
      }
      setLedger(Array.isArray(ledData.transactions) ? ledData.transactions : []);
      const uList = Array.isArray(usrData.users) ? usrData.users : [];
      setUsersList(uList);
      if (uList.length > 0 && !adjUserId) setAdjUserId(String(uList[0].id));
      if (materials.length > 0 && !rateMatId) setRateMatId(String(materials[0].id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load rewards data.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, rdStatusFilter, rdMethodFilter, rdSearch, materials, adjUserId, rateMatId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleTransition(redemption: RedemptionRecord, nextStatus: string) {
    setBusy(`rd-${redemption.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/redemptions/${redemption.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nextStatus,
          note: reviewNotes[redemption.id]?.trim() || undefined,
          payoutReference: payoutRefs[redemption.id]?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update redemption status.');
      setNotice(`${redemption.referenceCode} moved to ${nextStatus}.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transition failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleLightningPayout(redemption: RedemptionRecord) {
    setBusy(`ln-${redemption.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/integrations/lightning/payout/${redemption.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lightning payout failed.');
      setNotice(
        `Lightning payout processed (${data.payout.isSimulated ? 'SIMULATED PAYMENT — DEMO' : 'LIVE NWC'}). Ref: ${data.payout.payoutReference}`
      );
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lightning payout error.');
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveRate(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save-rate');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/reward-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialCategoryId: Number(rateMatId),
          pointsPerKg: ratePoints,
          isDemo: rateIsDemo,
          reason: rateReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save reward rate.');
      setRatePoints('');
      setRateReason('');
      setNotice('New active material reward rate saved. Past verified rewards remain unchanged.');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update rate.');
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save-settings');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/redemption-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minRedemptionPoints: minPts,
          pointsToNgnRate: ngnRate,
          pointsToSatsRate: satsRate,
          enabledMethods,
          isDemoRates,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update settings.');
      setSettings(data.settings);
      setNotice('Redemption threshold and conversion settings updated.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Settings update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleAdjustment(e: React.FormEvent) {
    e.preventDefault();
    setBusy('adj');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/wallet-adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: Number(adjUserId),
          signedAmountPoints: adjAmount,
          reason: adjReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Wallet adjustment failed.');
      setAdjAmount('');
      setAdjReason('');
      setNotice('Manual ledger adjustment posted and audited.');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Adjustment error.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['redemptions', `Redemption Queue (${redemptions.length})`],
              ['rates', 'Material Reward Rates'],
              ['settings', 'Redemption Rules'],
              ['ledger', 'Ledger & Adjustments'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`min-h-[40px] px-3.5 py-1.5 text-xs font-semibold rounded-sm cursor-pointer ${
                subTab === id
                  ? 'bg-[#17372D] text-[#F7F6F2]'
                  : 'bg-white border border-[#DAD7CE] text-[#3F4541] hover:bg-[#EFECE4]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => loadData()}
          className="min-h-[40px] px-3 py-1.5 text-xs font-medium border border-[#C9C5BA] bg-white rounded-sm inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="p-3.5 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="p-3.5 text-sm text-[#17372D] bg-[#EEF4F0] border border-[#B7CEC0] rounded-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {/* SUBTAB 1: REDEMPTIONS */}
      {subTab === 'redemptions' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              value={rdSearch}
              onChange={(e) => setRdSearch(e.target.value)}
              placeholder="Search ref, name, or email..."
              className="min-h-[40px] px-3 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <select
              value={rdStatusFilter}
              onChange={(e) => setRdStatusFilter(e.target.value)}
              className="min-h-[40px] px-3 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="PROCESSING">Processing</option>
              <option value="PAID">Paid</option>
              <option value="REJECTED">Rejected</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select
              value={rdMethodFilter}
              onChange={(e) => setRdMethodFilter(e.target.value)}
              className="min-h-[40px] px-3 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            >
              <option value="ALL">All Payout Methods</option>
              {ALL_METHODS.map((m) => (
                <option key={m} value={m}>
                  {REDEMPTION_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <p className="text-sm text-[#59605B]">Loading redemption queue...</p>
          ) : redemptions.length === 0 ? (
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 text-sm text-[#59605B]">
              No redemption requests match the selected filters.
            </div>
          ) : (
            <div className="space-y-3">
              {redemptions.map((r) => {
                const meta = REDEMPTION_STATUS_META[r.status] ?? {
                  label: r.status,
                  textClass: 'text-[#3F4541]',
                };
                const canAct = r.status === 'PENDING' || r.status === 'APPROVED' || r.status === 'PROCESSING';
                return (
                  <div key={r.id} className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span className="font-mono font-semibold text-[#171B19]">
                            {r.referenceCode}
                          </span>
                          <span className={`font-semibold ${meta.textClass}`}>{meta.label}</span>
                          {r.isSimulatedPayout && (
                            <span className="font-mono text-xs text-[#8A4E11] border border-[#DFC79F] bg-[#FDF8EE] px-1.5 py-0.5 rounded-sm">
                              SIMULATED PAYMENT
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-[#171B19]">
                          <strong>{r.userName}</strong> ({r.userEmail}) ·{' '}
                          <span className="font-mono font-semibold tabular-nums">
                            {r.pointsRequested} pts
                          </span>{' '}
                          · {REDEMPTION_METHOD_LABELS[r.method]}
                        </p>
                        <p className="text-xs text-[#59605B] mt-0.5">
                          Destination: <span className="font-mono">{r.destinationDetails}</span> ·
                          Est. ₦{r.estimatedNgnValue ?? '0.00'} / {r.estimatedSatsValue ?? 0} sats ·{' '}
                          {formatDateTime(r.createdAt)}
                        </p>
                        {r.payoutReference && (
                          <p className="text-xs font-mono text-[#14532D] mt-0.5">
                            Payout Reference: {r.payoutReference}
                          </p>
                        )}
                      </div>
                    </div>

                    {canAct && (
                      <div className="pt-3 border-t border-[#E5E2D9] space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <input
                            type="text"
                            value={payoutRefs[r.id] ?? ''}
                            onChange={(e) =>
                              setPayoutRefs((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                            placeholder="Payout reference (required to Mark Paid)"
                            className="min-h-[40px] px-3 text-xs font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                          />
                          <input
                            type="text"
                            value={reviewNotes[r.id] ?? ''}
                            onChange={(e) =>
                              setReviewNotes((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                            placeholder="Review / rejection note (required for Reject or Fail)"
                            className="min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {r.status === 'PENDING' && (
                            <>
                              <button
                                type="button"
                                disabled={busy === `rd-${r.id}`}
                                onClick={() => handleTransition(r, 'APPROVED')}
                                className="min-h-[38px] px-3.5 text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={busy === `rd-${r.id}`}
                                onClick={() => handleTransition(r, 'REJECTED')}
                                className="min-h-[38px] px-3.5 text-xs font-semibold text-[#991B1B] border border-[#E6B8B0] bg-[#FDF2F0] rounded-sm cursor-pointer"
                              >
                                Reject &amp; Reverse
                              </button>
                            </>
                          )}
                          {r.status === 'APPROVED' && (
                            <>
                              <button
                                type="button"
                                disabled={busy === `rd-${r.id}`}
                                onClick={() => handleTransition(r, 'PROCESSING')}
                                className="min-h-[38px] px-3.5 text-xs font-semibold text-[#8A4E11] border border-[#DFC79F] bg-[#FDF8EE] rounded-sm cursor-pointer"
                              >
                                Mark Processing
                              </button>
                              {r.method === 'BITCOIN_LIGHTNING' && (
                                <button
                                  type="button"
                                  disabled={busy === `ln-${r.id}`}
                                  onClick={() => handleLightningPayout(r)}
                                  className="min-h-[38px] px-3.5 text-xs font-semibold bg-[#8A4E11] text-[#F7F6F2] rounded-sm cursor-pointer"
                                >
                                  {busy === `ln-${r.id}`
                                    ? 'Executing...'
                                    : 'Run Lightning Payout (Configured Mode)'}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy === `rd-${r.id}`}
                                onClick={() => handleTransition(r, 'PAID')}
                                className="min-h-[38px] px-3.5 text-xs font-semibold bg-[#14532D] text-[#F7F6F2] rounded-sm cursor-pointer"
                              >
                                Mark Paid (Manual Ref)
                              </button>
                              <button
                                type="button"
                                disabled={busy === `rd-${r.id}`}
                                onClick={() => handleTransition(r, 'REJECTED')}
                                className="min-h-[38px] px-3.5 text-xs font-semibold text-[#991B1B] border border-[#E6B8B0] bg-[#FDF2F0] rounded-sm cursor-pointer"
                              >
                                Reject &amp; Reverse
                              </button>
                            </>
                          )}
                          {r.status === 'PROCESSING' && (
                            <>
                              {r.method === 'BITCOIN_LIGHTNING' && (
                                <button
                                  type="button"
                                  disabled={busy === `ln-${r.id}`}
                                  onClick={() => handleLightningPayout(r)}
                                  className="min-h-[38px] px-3.5 text-xs font-semibold bg-[#8A4E11] text-[#F7F6F2] rounded-sm cursor-pointer"
                                >
                                  Run Lightning Payout
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busy === `rd-${r.id}`}
                                onClick={() => handleTransition(r, 'PAID')}
                                className="min-h-[38px] px-3.5 text-xs font-semibold bg-[#14532D] text-[#F7F6F2] rounded-sm cursor-pointer"
                              >
                                Mark Paid
                              </button>
                              <button
                                type="button"
                                disabled={busy === `rd-${r.id}`}
                                onClick={() => handleTransition(r, 'FAILED')}
                                className="min-h-[38px] px-3.5 text-xs font-semibold text-[#991B1B] border border-[#E6B8B0] bg-[#FDF2F0] rounded-sm cursor-pointer"
                              >
                                Mark Failed &amp; Reverse
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: MATERIAL REWARD RATES */}
      {subTab === 'rates' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSaveRate}
            className="lg:col-span-5 bg-white border border-[#DAD7CE] rounded-sm p-6 space-y-4 self-start"
          >
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Publish New Material Rate
            </h3>
            <p className="text-xs text-[#59605B]">
              Updating a rate creates a new active version and preserves historical rates on past
              verified collections.
            </p>
            <div>
              <label className="block text-xs font-medium text-[#171B19]">Material category</label>
              <select
                value={rateMatId}
                onChange={(e) => setRateMatId(e.target.value)}
                className="mt-1 w-full min-h-[42px] px-3 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171B19]">
                Reward points per kg
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={ratePoints}
                onChange={(e) => setRatePoints(e.target.value)}
                placeholder="e.g. 55.00"
                className="mt-1 w-full min-h-[42px] px-3 text-sm font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171B19]">
                Change justification
              </label>
              <input
                type="text"
                required
                value={rateReason}
                onChange={(e) => setRateReason(e.target.value)}
                placeholder="e.g. Updated Q4 Owerri recycling buyer price"
                className="mt-1 w-full min-h-[42px] px-3 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[#3F4541]">
              <input
                type="checkbox"
                checked={rateIsDemo}
                onChange={(e) => setRateIsDemo(e.target.checked)}
                className="h-4 w-4 accent-[#17372D]"
              />
              <span>Label as DEMO / Pilot Rate</span>
            </label>
            <button
              type="submit"
              disabled={busy === 'save-rate'}
              className="w-full min-h-[44px] text-sm font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
            >
              {busy === 'save-rate' ? 'Saving Rate...' : 'Activate New Rate'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-[#DAD7CE] rounded-sm overflow-x-auto">
            <div className="p-4 border-b border-[#E5E2D9]">
              <h3 className="font-display text-lg font-semibold text-[#171B19]">
                Rate Schedule &amp; History
              </h3>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F7F6F2] border-b border-[#DAD7CE] text-[#59605B] uppercase">
                  <th className="py-2.5 px-3">Material</th>
                  <th className="py-2.5 px-3 text-right">Pts / kg</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Reason</th>
                  <th className="py-2.5 px-3">Effective</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E2D9]">
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-3 font-medium text-[#171B19]">{r.materialName}</td>
                    <td className="py-2.5 px-3 font-mono text-right tabular-nums">
                      {r.pointsPerKg}
                      {r.isDemo ? ' [DEMO]' : ''}
                    </td>
                    <td className="py-2.5 px-3 font-semibold">
                      <span className={r.isActive ? 'text-[#14532D]' : 'text-[#59605B]'}>
                        {r.isActive ? 'ACTIVE' : 'HISTORICAL'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[#59605B]">{r.changeReason}</td>
                    <td className="py-2.5 px-3 font-mono text-[#59605B]">
                      {formatDateTime(r.effectiveFrom)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 3: REDEMPTION SETTINGS */}
      {subTab === 'settings' && settings && (
        <form
          onSubmit={handleSaveSettings}
          className="max-w-2xl bg-white border border-[#DAD7CE] rounded-sm p-6 space-y-5"
        >
          <h3 className="font-display text-xl font-semibold text-[#171B19]">
            Redemption Threshold &amp; Conversion Settings
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#171B19]">
                Min Redemption (pts)
              </label>
              <input
                type="number"
                step="0.01"
                value={minPts}
                onChange={(e) => setMinPts(e.target.value)}
                className="mt-1 w-full min-h-[42px] px-3 text-sm font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171B19]">NGN per 1 point</label>
              <input
                type="number"
                step="0.0001"
                value={ngnRate}
                onChange={(e) => setNgnRate(e.target.value)}
                className="mt-1 w-full min-h-[42px] px-3 text-sm font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171B19]">Sats per 1 point</label>
              <input
                type="number"
                step="0.0001"
                value={satsRate}
                onChange={(e) => setSatsRate(e.target.value)}
                className="mt-1 w-full min-h-[42px] px-3 text-sm font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-[#171B19] mb-2">Enabled redemption methods</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_METHODS.map((m) => (
                <label
                  key={m}
                  className="flex items-center gap-2 p-2.5 border border-[#E5E2D9] rounded-sm text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={enabledMethods.includes(m)}
                    onChange={() =>
                      setEnabledMethods((prev) =>
                        prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
                      )
                    }
                    className="h-4 w-4 accent-[#17372D]"
                  />
                  <span>{REDEMPTION_METHOD_LABELS[m]}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[#3F4541]">
            <input
              type="checkbox"
              checked={isDemoRates}
              onChange={(e) => setIsDemoRates(e.target.checked)}
              className="h-4 w-4 accent-[#17372D]"
            />
            <span>Mark conversion estimates as DEMO pilot rates</span>
          </label>

          <button
            type="submit"
            disabled={busy === 'save-settings'}
            className="min-h-[44px] px-6 text-sm font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
          >
            {busy === 'save-settings' ? 'Saving...' : 'Save Redemption Settings'}
          </button>
        </form>
      )}

      {/* SUBTAB 4: LEDGER & MANUAL ADJUSTMENT */}
      {subTab === 'ledger' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleAdjustment}
            className="lg:col-span-4 bg-white border border-[#DAD7CE] rounded-sm p-6 space-y-4 self-start"
          >
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Manual Wallet Adjustment
            </h3>
            <p className="text-xs text-[#59605B]">
              Posts an audited ledger entry. Negative adjustments cannot reduce a wallet below 0.00.
            </p>
            <div>
              <label className="block text-xs font-medium text-[#171B19]">Participant</label>
              <select
                value={adjUserId}
                onChange={(e) => setAdjUserId(e.target.value)}
                className="mt-1 w-full min-h-[42px] px-3 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              >
                {usersList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.email})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171B19]">
                Signed points (+credit or -debit)
              </label>
              <input
                type="text"
                required
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                placeholder="e.g. 25.00 or -10.00"
                className="mt-1 w-full min-h-[42px] px-3 text-sm font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171B19]">
                Audit reason (mandatory)
              </label>
              <textarea
                rows={2}
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="Explain why this adjustment is being posted..."
                className="mt-1 w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy === 'adj'}
              className="w-full min-h-[44px] text-sm font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
            >
              {busy === 'adj' ? 'Posting...' : 'Post Audited Adjustment'}
            </button>
          </form>

          <div className="lg:col-span-8 bg-white border border-[#DAD7CE] rounded-sm overflow-x-auto">
            <div className="p-4 border-b border-[#E5E2D9]">
              <h3 className="font-display text-lg font-semibold text-[#171B19]">
                Recent Platform Reward Ledger ({ledger.length})
              </h3>
            </div>
            {ledger.length === 0 ? (
              <p className="p-6 text-sm text-[#59605B]">No ledger transactions recorded yet.</p>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F6F2] border-b border-[#DAD7CE] text-[#59605B] uppercase">
                    <th className="py-2.5 px-3">Ref</th>
                    <th className="py-2.5 px-3">User</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">Signed</th>
                    <th className="py-2.5 px-3 text-right">After</th>
                    <th className="py-2.5 px-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E2D9]">
                  {ledger.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-2.5 px-3 font-mono">{tx.referenceCode}</td>
                      <td className="py-2.5 px-3">{tx.userName ?? `#${tx.userId}`}</td>
                      <td className="py-2.5 px-3">
                        <span className="font-medium">
                          {LEDGER_TYPE_LABELS[tx.transactionType] ?? tx.transactionType}
                        </span>
                        <p className="text-[#59605B]">{tx.description}</p>
                      </td>
                      <td
                        className={`py-2.5 px-3 font-mono text-right font-semibold tabular-nums ${
                          tx.direction === 'CREDIT' ? 'text-[#14532D]' : 'text-[#991B1B]'
                        }`}
                      >
                        {tx.signedPoints}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-right tabular-nums">
                        {tx.balanceAfter}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#59605B] whitespace-nowrap">
                        {formatDateTime(tx.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
