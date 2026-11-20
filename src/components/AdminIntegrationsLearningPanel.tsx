import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/status-labels';

interface IntegrationSettingsSafe {
  lightningEnabled: boolean;
  lightningMode: string;
  nwcConfigured: boolean;
  nwcRelayHost: string | null;
  nwcWalletPubkeyPreview: string | null;
  nostrEnabled: boolean;
  nostrMode: string;
  nostrRelayUrls: string[];
  nostrAutoPublish: boolean;
  aiSorterEnabled: boolean;
  aiProvider: string;
  geminiConfigured: boolean;
}

interface LightningPaymentRow {
  id: number;
  redemptionRequestId: number;
  redemptionReference: string;
  mode: string;
  destinationMasked: string;
  amountSats: number;
  status: string;
  isSimulated: boolean;
  simulatedReference: string | null;
  paymentHash: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface NostrPublicationRow {
  id: number;
  verificationId: number;
  collectionReference: string;
  mode: string;
  status: string;
  eventId: string | null;
  payloadJson: string;
  retryCount: number;
  errorMessage: string | null;
  publishedAt: string | null;
  createdAt: string;
}

interface AdminLearningModuleRow {
  id: number;
  title: string;
  topic: string;
  summary: string;
  passingScorePercent: number;
  bonusPoints: string;
  isActive: boolean;
  isDemo: boolean;
  completionsPassed: number;
  attemptsTotal: number;
}

export function AdminIntegrationsLearningPanel() {
  const { authFetch } = useAuth();
  const [subTab, setSubTab] = useState<'settings' | 'lightning' | 'nostr' | 'learning'>('settings');

  const [settings, setSettings] = useState<IntegrationSettingsSafe | null>(null);
  const [payments, setPayments] = useState<LightningPaymentRow[]>([]);
  const [publications, setPublications] = useState<NostrPublicationRow[]>([]);
  const [eligibleVerifications, setEligibleVerifications] = useState<
    Array<{
      verificationId: number;
      collectionReference: string;
      materialName: string;
      verifiedEligibleWeightKg: string;
      alreadyPublished: boolean;
    }>
  >([]);
  const [learningModules, setLearningModules] = useState<AdminLearningModuleRow[]>([]);

  // Settings form state
  const [lnEnabled, setLnEnabled] = useState(true);
  const [lnMode, setLnMode] = useState('DEMO');
  const [adminNwcUri, setAdminNwcUri] = useState('');
  const [nostrEnabled, setNostrEnabled] = useState(true);
  const [nostrMode, setNostrMode] = useState('DEMO');
  const [nostrRelaysText, setNostrRelaysText] = useState('wss://relay.damus.io, wss://nos.lol');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiProvider, setAiProvider] = useState('GEMINI');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [setRes, payRes, pubRes, modRes] = await Promise.all([
        authFetch('/api/admin/integrations/settings'),
        authFetch('/api/admin/integrations/lightning/payments'),
        authFetch('/api/admin/integrations/nostr/publications'),
        authFetch('/api/admin/learning/modules'),
      ]);
      const [setD, payD, pubD, modD] = await Promise.all([
        setRes.ok ? setRes.json() : Promise.resolve({ settings: null }),
        payRes.ok ? payRes.json() : Promise.resolve({ payments: [] }),
        pubRes.ok ? pubRes.json() : Promise.resolve({ publications: [], eligibleVerifications: [] }),
        modRes.ok ? modRes.json() : Promise.resolve({ modules: [] }),
      ]);

      if (setD.settings) {
        const s: IntegrationSettingsSafe = setD.settings;
        setSettings(s);
        setLnEnabled(s.lightningEnabled);
        setLnMode(s.lightningMode);
        setNostrEnabled(s.nostrEnabled);
        setNostrMode(s.nostrMode);
        setNostrRelaysText(s.nostrRelayUrls.join(', '));
        setAiEnabled(s.aiSorterEnabled);
        setAiProvider(s.aiProvider);
      }
      setPayments(Array.isArray(payD.payments) ? payD.payments : []);
      setPublications(Array.isArray(pubD.publications) ? pubD.publications : []);
      setEligibleVerifications(
        Array.isArray(pubD.eligibleVerifications) ? pubD.eligibleVerifications : []
      );
      setLearningModules(Array.isArray(modD.modules) ? modD.modules : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load integrations.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save-int');
    setError(null);
    setNotice(null);
    try {
      const relays = nostrRelaysText
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const res = await authFetch('/api/admin/integrations/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lightningEnabled: lnEnabled,
          lightningMode: lnMode,
          nwcUri: adminNwcUri.trim() || undefined,
          nostrEnabled,
          nostrMode,
          nostrRelayUrls: relays,
          aiSorterEnabled: aiEnabled,
          aiProvider,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save integration settings.');
      setAdminNwcUri('');
      setSettings(data.settings);
      setNotice('Integration settings updated securely.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnectAdminNwc() {
    setBusy('disc-nwc');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/integrations/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disconnectNwc: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Disconnect failed.');
      setSettings(data.settings);
      setNotice('Platform NWC wallet credentials removed.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Disconnect failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handlePublishNostr(verificationId: number) {
    setBusy(`pub-${verificationId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/integrations/nostr/publish/${verificationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publishing failed.');
      setNotice(`Proof-of-Recycling published (${data.publication.status} · ${data.publication.mode}).`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Nostr publishing failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleModuleActive(mod: AdminLearningModuleRow) {
    setBusy(`mod-${mod.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/learning/modules/${mod.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !mod.isActive }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not toggle module.');
      }
      setNotice(`Module "${mod.title}" is now ${!mod.isActive ? 'ACTIVE' : 'INACTIVE'}.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed.');
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
              ['settings', 'Integration Settings'],
              ['lightning', `Lightning Payouts (${payments.length})`],
              ['nostr', `Nostr Proof-of-Recycling (${publications.length})`],
              ['learning', `Learn & Earn Modules (${learningModules.length})`],
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

      {loading && <p className="text-sm text-[#59605B]">Loading integration configuration...</p>}

      {/* SETTINGS */}
      {!loading && subTab === 'settings' && settings && (
        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Lightning / NWC */}
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-4">
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Bitcoin Lightning &amp; NWC
            </h3>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={lnEnabled}
                onChange={(e) => setLnEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#17372D]"
              />
              <span>Enable Lightning integration</span>
            </label>
            <div>
              <label className="block text-xs font-medium">Mode</label>
              <select
                value={lnMode}
                onChange={(e) => setLnMode(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              >
                <option value="DISABLED">DISABLED</option>
                <option value="DEMO">DEMO (Simulated Payments — Clearly Labelled)</option>
                <option value="LIVE_NWC">LIVE_NWC (Requires Connected NWC Wallet)</option>
              </select>
            </div>
            {settings.nwcConfigured ? (
              <div className="p-3 bg-[#EEF4F0] border border-[#B7CEC0] rounded-sm text-xs space-y-1">
                <p className="font-semibold text-[#17372D]">Platform NWC Configured</p>
                <p className="font-mono">Relay: {settings.nwcRelayHost}</p>
                <p className="font-mono">Pubkey: {settings.nwcWalletPubkeyPreview}</p>
                <button
                  type="button"
                  onClick={handleDisconnectAdminNwc}
                  className="mt-1 text-[#991B1B] underline cursor-pointer"
                >
                  Remove NWC Secret
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium">
                  Platform NWC URI (encrypted server-side)
                </label>
                <input
                  type="password"
                  value={adminNwcUri}
                  onChange={(e) => setAdminNwcUri(e.target.value)}
                  placeholder="nostr+walletconnect://..."
                  className="mt-1 w-full min-h-[40px] px-3 text-xs font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                />
              </div>
            )}
          </div>

          {/* Nostr */}
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-4">
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Nostr Proof-of-Recycling
            </h3>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={nostrEnabled}
                onChange={(e) => setNostrEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#17372D]"
              />
              <span>Enable Proof-of-Recycling publishing</span>
            </label>
            <div>
              <label className="block text-xs font-medium">Publishing Mode</label>
              <select
                value={nostrMode}
                onChange={(e) => setNostrMode(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              >
                <option value="DISABLED">DISABLED</option>
                <option value="DEMO">DEMO (Local Signed Record — Zero PII)</option>
                <option value="LIVE">LIVE Relay Publishing</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Relay URLs (comma-separated)</label>
              <input
                type="text"
                value={nostrRelaysText}
                onChange={(e) => setNostrRelaysText(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <p className="text-xs text-[#59605B]">
              Strict Privacy Guard: Public events never contain names, emails, phones, or street
              addresses.
            </p>
          </div>

          {/* AI Sorter */}
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="font-display text-lg font-semibold text-[#171B19]">
                AI Waste Sorter Service
              </h3>
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                  className="h-4 w-4 accent-[#17372D]"
                />
                <span>Enable AI Waste Sorter</span>
              </label>
              <div>
                <label className="block text-xs font-medium">Provider</label>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                  className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                >
                  <option value="GEMINI">GEMINI (Server-side ENV key + deterministic fallback)</option>
                  <option value="DISABLED">DISABLED (Deterministic sorting guide only)</option>
                </select>
              </div>
              <p className="text-xs font-mono text-[#59605B]">
                Server API Key Configured: {settings.geminiConfigured ? 'YES (Env Secret)' : 'NO (Fallback Active)'}
              </p>
            </div>

            <button
              type="submit"
              disabled={busy === 'save-int'}
              className="w-full min-h-[44px] text-sm font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
            >
              {busy === 'save-int' ? 'Saving...' : 'Save All Integration Settings'}
            </button>
          </div>
        </form>
      )}

      {/* LIGHTNING PAYMENTS RECONCILIATION */}
      {!loading && subTab === 'lightning' && (
        <div className="bg-white border border-[#DAD7CE] rounded-sm overflow-x-auto">
          {payments.length === 0 ? (
            <p className="p-6 text-sm text-[#59605B]">
              No Lightning payout executions recorded yet. Approve a Bitcoin Lightning redemption in
              the Rewards &amp; Redemptions tab to trigger payout.
            </p>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F7F6F2] border-b border-[#DAD7CE] text-[#59605B] uppercase">
                  <th className="py-2.5 px-3">Redemption Ref</th>
                  <th className="py-2.5 px-3">Mode</th>
                  <th className="py-2.5 px-3">Destination</th>
                  <th className="py-2.5 px-3 text-right">Sats</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Reference</th>
                  <th className="py-2.5 px-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E2D9]">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 px-3 font-mono font-semibold">{p.redemptionReference}</td>
                    <td className="py-2.5 px-3 font-mono">
                      {p.mode}
                      {p.isSimulated ? ' (SIMULATED)' : ''}
                    </td>
                    <td className="py-2.5 px-3 font-mono">{p.destinationMasked}</td>
                    <td className="py-2.5 px-3 font-mono text-right tabular-nums">{p.amountSats}</td>
                    <td className="py-2.5 px-3 font-semibold">{p.status}</td>
                    <td className="py-2.5 px-3 font-mono text-[#59605B]">
                      {p.simulatedReference || p.paymentHash || p.errorMessage || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#59605B]">
                      {formatDateTime(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* NOSTR PROOF-OF-RECYCLING */}
      {!loading && subTab === 'nostr' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#DAD7CE] rounded-sm">
            <div className="p-4 border-b border-[#E5E2D9]">
              <h3 className="font-display text-lg font-semibold text-[#171B19]">
                Verified Collections Eligible for Proof-of-Recycling
              </h3>
            </div>
            {eligibleVerifications.length === 0 ? (
              <p className="p-5 text-sm text-[#59605B]">
                No approved weight verifications yet.
              </p>
            ) : (
              <div className="divide-y divide-[#E5E2D9]">
                {eligibleVerifications.map((v) => (
                  <div key={v.verificationId} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="font-mono font-semibold text-[#171B19]">
                        {v.collectionReference}
                      </span>{' '}
                      · {v.materialName} ·{' '}
                      <strong className="font-mono">{v.verifiedEligibleWeightKg} kg</strong>
                    </div>
                    {v.alreadyPublished ? (
                      <span className="font-mono text-[#14532D] font-semibold">PUBLISHED</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === `pub-${v.verificationId}`}
                        onClick={() => handlePublishNostr(v.verificationId)}
                        className="min-h-[34px] px-3 text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
                      >
                        Publish Zero-PII Proof
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-[#DAD7CE] rounded-sm divide-y divide-[#E5E2D9]">
            <div className="p-4">
              <h3 className="font-display text-lg font-semibold text-[#171B19]">
                Publication Log ({publications.length})
              </h3>
            </div>
            {publications.length === 0 ? (
              <p className="p-5 text-sm text-[#59605B]">No Nostr events published yet.</p>
            ) : (
              publications.map((pub) => (
                <div key={pub.id} className="p-4 space-y-1.5 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-mono font-semibold">
                      {pub.collectionReference} · {pub.status} ({pub.mode})
                    </span>
                    <span className="font-mono text-[#59605B]">
                      {pub.eventId ? `Event: ${pub.eventId.slice(0, 24)}...` : 'No event ID'}
                    </span>
                  </div>
                  <pre className="p-2.5 bg-[#F7F6F2] border border-[#E5E2D9] rounded-sm font-mono text-[11px] overflow-x-auto">
                    {pub.payloadJson}
                  </pre>
                  {pub.status === 'FAILED' && (
                    <button
                      type="button"
                      onClick={() => handlePublishNostr(pub.verificationId)}
                      className="min-h-[32px] px-3 text-xs font-semibold bg-[#8A4E11] text-[#F7F6F2] rounded-sm cursor-pointer"
                    >
                      Retry Publication (Attempts: {pub.retryCount})
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* LEARNING MODULES ADMIN */}
      {!loading && subTab === 'learning' && (
        <div className="bg-white border border-[#DAD7CE] rounded-sm divide-y divide-[#E5E2D9]">
          <div className="p-4">
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Configured Learn &amp; Earn Modules
            </h3>
          </div>
          {learningModules.map((mod) => (
            <div key={mod.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-semibold text-sm text-[#171B19]">
                  {mod.title} {mod.isDemo ? '[DEMO]' : ''}
                </p>
                <p className="text-[#59605B]">
                  {mod.topic} · Pass &ge; {mod.passingScorePercent}% · Bonus: +{mod.bonusPoints} pts ·{' '}
                  {mod.completionsPassed} passed / {mod.attemptsTotal} attempts
                </p>
              </div>
              <button
                type="button"
                disabled={busy === `mod-${mod.id}`}
                onClick={() => handleToggleModuleActive(mod)}
                className={`min-h-[34px] px-3 text-xs font-semibold rounded-sm cursor-pointer ${
                  mod.isActive
                    ? 'border border-[#C9C5BA] text-[#171B19] bg-[#F7F6F2]'
                    : 'bg-[#17372D] text-[#F7F6F2]'
                }`}
              >
                {mod.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
