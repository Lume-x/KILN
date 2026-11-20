import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  PILOT_COMMUNITY_AREAS,
  type AgentSummary,
  type AppRoute,
  type CollectionPoint,
  type CollectionRequestRecord,
  type MaterialCategory,
} from '../types/kiln';
import {
  QUALITY_GRADE_LABELS,
  STATUS_META,
  formatDateTime,
  formatMethodLabel,
  formatShortDate,
} from '../lib/status-labels';
import { AdminRewardsRedemptionsPanel } from './AdminRewardsRedemptionsPanel';
import { AdminInventoryPanel } from './AdminInventoryPanel';
import { AdminIntegrationsLearningPanel } from './AdminIntegrationsLearningPanel';
import { AdminUsersReportsPanel } from './AdminUsersReportsPanel';

interface AdminCollectionsPageProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
}

type AdminTab =
  | 'overview'
  | 'queue'
  | 'verifications'
  | 'points'
  | 'rewards'
  | 'inventory'
  | 'integrations'
  | 'governance';

interface AdminOverviewMetrics {
  users: { total: number; activeAgents: number; activeParticipants: number };
  collections: {
    totalRequests: number;
    pendingRequests: number;
    completedCollections: number;
    pendingVerifications: number;
    verifiedWeightKg: string;
  };
  rewards: {
    totalCreditedPoints: string;
    totalPendingRedemptionPoints: string;
    totalPaidRedemptionPoints: string;
    openRedemptions: number;
  };
  inventory: {
    unbatchedKg: string;
    batchedAvailableKg: string;
    activeBatches: number;
    transfersCount: number;
    salesCount: number;
    soldKg: string;
    salesRevenueNgn: string;
  };
  learning: {
    activeModules: number;
    passedCompletions: number;
    aiClassificationsCount: number;
  };
}

export function AdminCollectionsPage({ onNavigate }: AdminCollectionsPageProps) {
  const { user, loading: authLoading, authFetch } = useAuth();

  const [tab, setTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverviewMetrics | null>(null);
  const [requests, setRequests] = useState<CollectionRequestRecord[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [materials, setMaterials] = useState<MaterialCategory[]>([]);
  const [points, setPoints] = useState<CollectionPoint[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters for collection queue
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Per-request selected agent & rejection reason
  const [selectedAgents, setSelectedAgents] = useState<Record<number, string>>({});
  const [verifyNotes, setVerifyNotes] = useState<Record<number, string>>({});

  // Collection point form
  const [showNewPointForm, setShowNewPointForm] = useState(false);
  const [ptName, setPtName] = useState('');
  const [ptArea, setPtArea] = useState<string>(PILOT_COMMUNITY_AREAS[0]);
  const [ptAddress, setPtAddress] = useState('');
  const [ptDescription, setPtDescription] = useState('');
  const [ptHours, setPtHours] = useState('');
  const [ptContact, setPtContact] = useState('');
  const [ptStatus, setPtStatus] = useState('DEMO');

  useEffect(() => {
    if (!authLoading && !user) {
      onNavigate('/login');
    }
  }, [authLoading, user, onNavigate]);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reqRes, agentRes, pointRes, matRes, ovRes] = await Promise.all([
        authFetch('/api/admin/collections'),
        authFetch('/api/admin/agents'),
        authFetch('/api/admin/collection-points'),
        fetch('/api/public/materials'),
        authFetch('/api/admin/overview'),
      ]);

      if (reqRes.status === 403) {
        throw new Error('Administrator privileges are required to access this operations console.');
      }
      if (!reqRes.ok) {
        const d = await reqRes.json().catch(() => ({}));
        throw new Error(d.error || 'Could not load collection operations queue.');
      }

      const [reqData, agentData, pointData, matData, ovData] = await Promise.all([
        reqRes.json(),
        agentRes.ok ? agentRes.json() : Promise.resolve({ agents: [] }),
        pointRes.ok ? pointRes.json() : Promise.resolve({ collectionPoints: [] }),
        matRes.ok ? matRes.json() : Promise.resolve({ materials: [] }),
        ovRes.ok ? ovRes.json() : Promise.resolve({ overview: null }),
      ]);

      const loadedAgents: AgentSummary[] = Array.isArray(agentData.agents) ? agentData.agents : [];
      setRequests(Array.isArray(reqData.requests) ? reqData.requests : []);
      setAgents(loadedAgents);
      setPoints(Array.isArray(pointData.collectionPoints) ? pointData.collectionPoints : []);
      setMaterials(Array.isArray(matData.materials) ? matData.materials : []);
      setOverview(ovData.overview ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load admin console.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (user && user.role === 'ADMIN') {
      loadAdminData();
    } else if (user) {
      setLoading(false);
    }
  }, [user, loadAdminData]);

  const pendingVerifications = useMemo(
    () => requests.filter((r) => r.status === 'AWAITING_VERIFICATION'),
    [requests]
  );

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (methodFilter !== 'ALL' && r.collectionMethod !== methodFilter) return false;
      if (categoryFilter !== 'ALL' && String(r.materialCategoryId) !== categoryFilter) return false;
      return true;
    });
  }, [requests, statusFilter, methodFilter, categoryFilter]);

  const metrics = useMemo(() => {
    let pending = 0;
    let awaitingVerify = 0;
    let verified = 0;
    let verifiedCg = 0;

    for (const r of requests) {
      if (r.status === 'PENDING' || r.status === 'APPROVED') pending += 1;
      if (r.status === 'AWAITING_VERIFICATION') awaitingVerify += 1;
      if (r.status === 'VERIFIED' && r.verification?.decision === 'APPROVED') {
        verified += 1;
        const [w, f = '00'] = r.verification.verifiedEligibleWeightKg.split('.');
        verifiedCg += Number(w) * 100 + Number((f + '00').slice(0, 2));
      }
    }

    return {
      total: requests.length,
      pending,
      awaitingVerify,
      verified,
      verifiedKg: `${Math.floor(verifiedCg / 100)}.${String(verifiedCg % 100).padStart(2, '0')}`,
    };
  }, [requests]);

  async function handleApproveOrRejectRequest(
    req: CollectionRequestRecord,
    decision: 'APPROVED' | 'REJECTED'
  ) {
    setBusyId(`review-${req.id}`);
    setError(null);
    setNotice(null);
    try {
      const reason =
        decision === 'REJECTED' ? 'Rejected during coordinator intake review' : undefined;
      const res = await authFetch(`/api/admin/collections/${req.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update request.');
      setRequests((prev) => prev.map((item) => (item.id === req.id ? data.request : item)));
      setNotice(`${req.referenceCode} marked ${decision}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update request status.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleAssignAgent(req: CollectionRequestRecord) {
    const agentIdStr = selectedAgents[req.id] || (agents[0] ? String(agents[0].id) : '');
    const agentUserId = Number(agentIdStr);
    if (!agentUserId) {
      setError('No active collection agent available to assign.');
      return;
    }

    setBusyId(`assign-${req.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/collections/${req.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentUserId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not assign collection agent.');
      setRequests((prev) => prev.map((item) => (item.id === req.id ? data.request : item)));
      setNotice(
        `Assigned ${data.request.activeAssignment?.agentName ?? 'agent'} to ${req.referenceCode}.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to assign agent.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleVerificationDecision(
    req: CollectionRequestRecord,
    decision: 'APPROVED' | 'REJECTED'
  ) {
    setBusyId(`verify-${req.id}`);
    setError(null);
    setNotice(null);
    try {
      const reviewNotes =
        verifyNotes[req.id]?.trim() ||
        (decision === 'APPROVED'
          ? 'Physical weighing record reviewed and verified.'
          : 'Weight record rejected — requires re-inspection.');

      const res = await authFetch(`/api/admin/collections/${req.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reviewNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit verification decision.');
      setRequests((prev) => prev.map((item) => (item.id === req.id ? data.request : item)));
      setNotice(
        decision === 'APPROVED'
          ? `Verified ${req.referenceCode} (${data.request.verification?.verifiedEligibleWeightKg} kg eligible · +${data.request.verification?.pointsAwarded ?? '0.00'} pts credited & auto-received to inventory).`
          : `Rejected weight verification for ${req.referenceCode}.`
      );
      await loadAdminData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreatePoint(e: React.FormEvent) {
    e.preventDefault();
    setBusyId('create-point');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/collection-points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ptName,
          communityArea: ptArea,
          address: ptAddress,
          description: ptDescription,
          operatingHours: ptHours,
          contactInfo: ptContact,
          status: ptStatus,
          isDemo: ptStatus === 'DEMO' || ptStatus === 'PLANNED',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create collection point.');
      setPoints((prev) => [...prev, data.collectionPoint]);
      setShowNewPointForm(false);
      setPtName('');
      setPtAddress('');
      setPtDescription('');
      setPtHours('');
      setPtContact('');
      setNotice(`Created collection point "${data.collectionPoint.name}".`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to create collection point.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdatePointStatus(point: CollectionPoint, nextStatus: string) {
    setBusyId(`point-${point.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/collection-points/${point.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          isDemo: nextStatus === 'DEMO' ? true : point.isDemo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update collection point status.');
      setPoints((prev) => prev.map((p) => (p.id === point.id ? data.collectionPoint : p)));
      setNotice(`Updated "${point.name}" status to ${nextStatus}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to update collection point.');
    } finally {
      setBusyId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <p className="text-sm text-[#59605B]">Loading administrator console...</p>
      </main>
    );
  }

  if (user.role !== 'ADMIN') {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-lg bg-white border border-[#DAD7CE] rounded-sm p-8">
          <h1 className="font-display text-2xl font-semibold text-[#171B19]">
            Administrator Access Required
          </h1>
          <p className="mt-2 text-sm text-[#3F4541]">
            Your account role ({user.role}) cannot access KILN administrative dispatch,
            verification, or collection point management.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/collections')}
            className="mt-5 min-h-[44px] px-5 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] rounded-sm cursor-pointer"
          >
            Return to Collections
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
      <div className="pb-6 border-b border-[#DAD7CE] flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#59605B]">
            KILN Operations Console · Stages 1–8 Administration
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
            KILN Administration Console
          </h1>
          <p className="mt-1 text-sm text-[#3F4541]">
            Live operational metrics, collections, verifications, rewards, inventory traceability,
            integrations, reports, and audit logs.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAdminData}
          className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#17372D] border border-[#17372D] hover:bg-[#EFECE4] rounded-sm self-start sm:self-auto cursor-pointer"
        >
          Refresh Operations
        </button>
      </div>

      {/* Live DB Operational Metrics Strip */}
      <section className="mt-6 grid grid-cols-2 lg:grid-cols-5 border border-[#DAD7CE] bg-white rounded-sm divide-y lg:divide-y-0 sm:divide-x divide-[#DAD7CE]">
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Total requests</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
            {metrics.total}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Needs dispatch</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#8A4E11] tabular-nums">
            {metrics.pending}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Pending verification</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#8A4E11] tabular-nums">
            {metrics.awaitingVerify}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Verified eligible kg</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#14532D] tabular-nums">
            {metrics.verifiedKg} kg
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Open redemptions</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#17372D] tabular-nums">
            {overview?.rewards.openRedemptions ?? 0}
          </p>
        </div>
      </section>

      {notice && (
        <div
          role="status"
          className="mt-5 p-4 bg-[#EEF4F0] border border-[#17372D] rounded-sm text-sm text-[#171B19] flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 text-[#17372D] shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 p-4 bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm text-sm text-[#7F2315]"
        >
          {error}
        </div>
      )}

      {/* Console Tabs */}
      <div className="mt-6 flex flex-wrap items-center gap-1 p-1 bg-[#E5E2D9] rounded-sm">
        {(
          [
            ['overview', 'Overview'],
            ['queue', `Collections (${requests.length})`],
            ['verifications', `Verifications (${pendingVerifications.length})`],
            ['points', `Drop-Off Points (${points.length})`],
            ['rewards', 'Rewards & Redemptions'],
            ['inventory', 'Inventory & Sales'],
            ['integrations', 'Integrations & Learn'],
            ['governance', 'Users, Reports & Audit'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-[40px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-sm cursor-pointer whitespace-nowrap ${
              tab === id ? 'bg-[#17372D] text-[#F7F6F2]' : 'text-[#3F4541] hover:text-[#171B19]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 0: STAGE 8 LIVE OVERVIEW */}
      {tab === 'overview' && (
        <section className="mt-6 space-y-6">
          {!overview ? (
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 text-sm text-[#59605B]">
              Loading live database metrics...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-1">
                <p className="text-xs font-semibold uppercase text-[#59605B]">Community &amp; Agents</p>
                <p className="font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {overview.users.total} Users
                </p>
                <p className="text-xs text-[#59605B]">
                  {overview.users.activeParticipants} active participants ·{' '}
                  {overview.users.activeAgents} active agents
                </p>
              </div>

              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-1">
                <p className="text-xs font-semibold uppercase text-[#59605B]">Verified Rewards</p>
                <p className="font-mono text-2xl font-semibold text-[#17372D] tabular-nums">
                  {overview.rewards.totalCreditedPoints} pts
                </p>
                <p className="text-xs text-[#59605B]">
                  Pending: {overview.rewards.totalPendingRedemptionPoints} pts · Paid:{' '}
                  {overview.rewards.totalPaidRedemptionPoints} pts
                </p>
              </div>

              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-1">
                <p className="text-xs font-semibold uppercase text-[#59605B]">Inventory &amp; Sales</p>
                <p className="font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {overview.inventory.batchedAvailableKg} kg batched
                </p>
                <p className="text-xs text-[#59605B]">
                  Unbatched: {overview.inventory.unbatchedKg} kg · Sold: {overview.inventory.soldKg}{' '}
                  kg (₦{overview.inventory.salesRevenueNgn})
                </p>
              </div>

              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-1">
                <p className="text-xs font-semibold uppercase text-[#59605B]">AI Sorter &amp; Learn</p>
                <p className="font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {overview.learning.passedCompletions} Passed
                </p>
                <p className="text-xs text-[#59605B]">
                  {overview.learning.activeModules} active modules ·{' '}
                  {overview.learning.aiClassificationsCount} AI sorting checks
                </p>
              </div>
            </div>
          )}

          <div className="bg-[#EFECE4] border border-[#DAD7CE] rounded-sm p-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-[#3F4541]">
              All figures above are computed directly from live PostgreSQL records. Zero fake or
              placeholder statistics are generated.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTab('verifications')}
                className="min-h-[40px] px-4 text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
              >
                Review Verifications ({pendingVerifications.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('rewards')}
                className="min-h-[40px] px-4 text-xs font-semibold border border-[#17372D] bg-white text-[#17372D] rounded-sm cursor-pointer"
              >
                Manage Redemptions
              </button>
              <button
                type="button"
                onClick={() => setTab('governance')}
                className="min-h-[40px] px-4 text-xs font-semibold border border-[#17372D] bg-white text-[#17372D] rounded-sm cursor-pointer"
              >
                Reports &amp; CSV Exports
              </button>
            </div>
          </div>
        </section>
      )}

      {/* TAB 1: COLLECTION REQUESTS QUEUE */}
      {tab === 'queue' && (
        <section className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 text-xs bg-white border border-[#C9C5BA] rounded-sm"
            >
              <option value="ALL">All Statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by material"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 text-xs bg-white border border-[#C9C5BA] rounded-sm"
            >
              <option value="ALL">All Materials</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by collection method"
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="min-h-[40px] px-3 py-1.5 text-xs bg-white border border-[#C9C5BA] rounded-sm"
            >
              <option value="ALL">All Methods</option>
              <option value="PICKUP">Scheduled Pickup</option>
              <option value="DROP_OFF">Approved Drop-Off</option>
            </select>
          </div>

          {loading ? (
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 animate-pulse space-y-3">
              <div className="h-8 bg-[#EFECE4]" />
              <div className="h-8 bg-[#EFECE4]" />
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-8 text-center text-sm text-[#59605B]">
              No collection requests match the selected filters.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredRequests.map((req) => {
                const meta = STATUS_META[req.status];
                const canAssign = req.status === 'PENDING' || req.status === 'APPROVED';
                const selectedAgentVal =
                  selectedAgents[req.id] ?? (agents[0] ? String(agents[0].id) : '');

                return (
                  <article
                    key={req.id}
                    className="bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-4"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#E6E3DA]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#59605B]">
                          <span className="font-mono font-semibold text-[#171B19]">
                            {req.referenceCode}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatMethodLabel(req.collectionMethod)}</span>
                          <span aria-hidden="true">·</span>
                          <span className={`font-semibold ${meta.textClass}`}>{meta.label}</span>
                          {req.isDemo && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#8A4E11]">Demo Account</span>
                            </>
                          )}
                        </div>
                        <h2 className="mt-1 font-display text-lg font-semibold text-[#171B19]">
                          {req.materialName} · {req.userName} ({req.communityArea})
                        </h2>
                      </div>

                      <div className="text-xs font-mono tabular-nums text-[#59605B] flex flex-wrap gap-4">
                        <span>Est: {req.estimatedWeightKg} kg</span>
                        {req.submission && (
                          <span className="text-[#171B19]">
                            Weighed Eligible: {req.submission.eligibleWeightKg} kg
                          </span>
                        )}
                        <span>Created: {formatShortDate(req.createdAt)}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-[#3F4541]">
                      <div>
                        <span className="text-[#59605B] block">Location / Drop-off</span>
                        {req.collectionMethod === 'PICKUP'
                          ? `${req.pickupAddress}${req.landmarksDirections ? ` (${req.landmarksDirections})` : ''}`
                          : req.collectionPointName}
                      </div>
                      <div>
                        <span className="text-[#59605B] block">Preferred Window</span>
                        {req.preferredWindow}
                      </div>
                      <div>
                        <span className="text-[#59605B] block">Assigned Agent</span>
                        {req.activeAssignment
                          ? `${req.activeAssignment.agentName} (${req.activeAssignment.status})`
                          : 'Unassigned'}
                      </div>
                    </div>

                    {/* Admin Actions Row */}
                    <div className="pt-3 border-t border-[#E6E3DA] flex flex-wrap items-center gap-3">
                      {req.status === 'PENDING' && (
                        <>
                          <button
                            type="button"
                            disabled={busyId === `review-${req.id}`}
                            onClick={() => handleApproveOrRejectRequest(req, 'APPROVED')}
                            className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-[#17372D] border border-[#17372D] hover:bg-[#EEF4F0] rounded-sm cursor-pointer"
                          >
                            Approve Intake
                          </button>
                          <button
                            type="button"
                            disabled={busyId === `review-${req.id}`}
                            onClick={() => handleApproveOrRejectRequest(req, 'REJECTED')}
                            className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-[#991B1B] border border-[#E6B8B0] hover:bg-[#FDF2F0] rounded-sm cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {canAssign && agents.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Select agent for ${req.referenceCode}`}
                            value={selectedAgentVal}
                            onChange={(e) =>
                              setSelectedAgents((prev) => ({
                                ...prev,
                                [req.id]: e.target.value,
                              }))
                            }
                            className="min-h-[40px] px-3 py-1.5 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                          >
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.fullName} ({a.serviceZone})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={busyId === `assign-${req.id}`}
                            onClick={() => handleAssignAgent(req)}
                            className="min-h-[40px] px-4 py-1.5 text-xs font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
                          >
                            {busyId === `assign-${req.id}` ? 'Assigning...' : 'Assign Agent'}
                          </button>
                        </div>
                      )}

                      {req.status === 'AWAITING_VERIFICATION' && (
                        <button
                          type="button"
                          onClick={() => setTab('verifications')}
                          className="min-h-[40px] px-4 py-1.5 text-xs font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
                        >
                          Review &amp; Verify Weight
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: PENDING WEIGHT VERIFICATIONS */}
      {tab === 'verifications' && (
        <section className="mt-6 space-y-5">
          {pendingVerifications.length === 0 ? (
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-8 text-center">
              <h2 className="font-display text-xl font-semibold text-[#171B19]">
                No pending weight verifications
              </h2>
              <p className="mt-2 text-sm text-[#59605B]">
                Once a collection agent records physical weights on an assigned collection, it will
                appear here for administrator approval.
              </p>
            </div>
          ) : (
            pendingVerifications.map((req) => (
              <article
                key={req.id}
                className="bg-white border border-[#DAD7CE] rounded-sm p-6 space-y-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-4 border-b border-[#E6E3DA]">
                  <div>
                    <p className="font-mono text-xs text-[#59605B]">
                      {req.referenceCode} · Recorded by {req.submission?.recordedByAgentName}
                    </p>
                    <h2 className="mt-1 font-display text-2xl font-semibold text-[#171B19]">
                      {req.submission?.materialName ?? req.materialName} — {req.userName}
                    </h2>
                  </div>
                  <span className="text-xs font-semibold text-[#8A4E11]">
                    Awaiting Verification
                  </span>
                </div>

                {req.submission && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-[#F7F6F2] border border-[#E6E3DA] rounded-sm font-mono tabular-nums text-sm">
                    <div>
                      <span className="block font-sans text-xs text-[#59605B]">
                        Participant Estimate
                      </span>
                      <span>{req.estimatedWeightKg} kg</span>
                    </div>
                    <div>
                      <span className="block font-sans text-xs text-[#59605B]">
                        Agent Actual Weight
                      </span>
                      <strong>{req.submission.actualWeightKg} kg</strong>
                    </div>
                    <div>
                      <span className="block font-sans text-xs text-[#59605B]">Rejected</span>
                      <strong className="text-[#8A4E11]">
                        {req.submission.rejectedWeightKg} kg
                      </strong>
                    </div>
                    <div>
                      <span className="block font-sans text-xs text-[#59605B]">
                        Eligible for Verification
                      </span>
                      <strong className="text-[#14532D]">
                        {req.submission.eligibleWeightKg} kg
                      </strong>
                    </div>
                  </div>
                )}

                {req.submission && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1.5">
                      <p>
                        <strong className="text-[#171B19]">Quality grade:</strong>{' '}
                        {QUALITY_GRADE_LABELS[req.submission.qualityGrade]}
                      </p>
                      <p className="text-xs text-[#59605B]">
                        Recorded at {formatDateTime(req.submission.createdAt)}
                      </p>
                      {req.submission.contaminationNotes && (
                        <p className="text-xs text-[#8A4E11]">
                          Contamination: {req.submission.contaminationNotes}
                        </p>
                      )}
                      {req.submission.agentNotes && (
                        <p className="text-xs text-[#3F4541]">
                          Agent remarks: {req.submission.agentNotes}
                        </p>
                      )}
                    </div>

                    {req.submission.evidencePhotoUrl && (
                      <div>
                        <p className="text-xs text-[#59605B] mb-1.5">Agent evidence photo</p>
                        <img
                          src={req.submission.evidencePhotoUrl}
                          alt="Physical weighing evidence"
                          className="w-full max-h-48 object-cover border border-[#DAD7CE] rounded-sm"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-4 border-t border-[#E6E3DA] space-y-3">
                  <label
                    htmlFor={`verify-note-${req.id}`}
                    className="block text-xs font-medium text-[#171B19]"
                  >
                    Administrator verification notes
                  </label>
                  <input
                    id={`verify-note-${req.id}`}
                    type="text"
                    value={verifyNotes[req.id] ?? ''}
                    onChange={(e) =>
                      setVerifyNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                    }
                    placeholder="Optional approval note, or mandatory reason if rejecting"
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={busyId === `verify-${req.id}`}
                      onClick={() => handleVerificationDecision(req, 'APPROVED')}
                      className="min-h-[44px] px-5 py-2 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer disabled:opacity-60"
                    >
                      {busyId === `verify-${req.id}`
                        ? 'Processing...'
                        : 'Approve & Mark Verified'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === `verify-${req.id}`}
                      onClick={() => handleVerificationDecision(req, 'REJECTED')}
                      className="min-h-[44px] px-5 py-2 text-sm font-semibold text-[#991B1B] border border-[#E6B8B0] hover:bg-[#FDF2F0] rounded-sm cursor-pointer disabled:opacity-60"
                    >
                      Reject Verification
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      )}

      {/* TAB 3: COLLECTION POINTS MANAGEMENT */}
      {tab === 'points' && (
        <section className="mt-6 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-[#3F4541]">
              Points with status <strong className="text-[#171B19]">ACTIVE</strong> or{' '}
              <strong className="text-[#171B19]">DEMO</strong> are selectable by participants in
              Drop-Off requests.
            </p>
            <button
              type="button"
              onClick={() => setShowNewPointForm((prev) => !prev)}
              className="min-h-[42px] px-4 py-2 text-xs font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{showNewPointForm ? 'Close Form' : 'Add Collection Point'}</span>
            </button>
          </div>

          {showNewPointForm && (
            <form
              onSubmit={handleCreatePoint}
              className="bg-white border border-[#17372D] rounded-sm p-6 space-y-4"
            >
              <h2 className="font-display text-xl font-semibold text-[#171B19]">
                New Collection Point
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pt-name" className="block text-xs font-medium text-[#171B19]">
                    Point name
                  </label>
                  <input
                    id="pt-name"
                    type="text"
                    required
                    value={ptName}
                    onChange={(e) => setPtName(e.target.value)}
                    placeholder="e.g. FUTO Engineering Axis Hub (Demo)"
                    className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  />
                </div>

                <div>
                  <label htmlFor="pt-area" className="block text-xs font-medium text-[#171B19]">
                    Community area
                  </label>
                  <select
                    id="pt-area"
                    value={ptArea}
                    onChange={(e) => setPtArea(e.target.value)}
                    className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  >
                    {PILOT_COMMUNITY_AREAS.map((area) => (
                      <option key={area} value={area}>
                        {area}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="pt-address" className="block text-xs font-medium text-[#171B19]">
                  Address / directions
                </label>
                <input
                  id="pt-address"
                  type="text"
                  required
                  value={ptAddress}
                  onChange={(e) => setPtAddress(e.target.value)}
                  className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                />
              </div>

              <div>
                <label htmlFor="pt-desc" className="block text-xs font-medium text-[#171B19]">
                  Description
                </label>
                <input
                  id="pt-desc"
                  type="text"
                  required
                  value={ptDescription}
                  onChange={(e) => setPtDescription(e.target.value)}
                  className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="pt-hours" className="block text-xs font-medium text-[#171B19]">
                    Operating hours
                  </label>
                  <input
                    id="pt-hours"
                    type="text"
                    required
                    value={ptHours}
                    onChange={(e) => setPtHours(e.target.value)}
                    placeholder="Mon–Sat, 09:00–17:00"
                    className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  />
                </div>

                <div>
                  <label htmlFor="pt-contact" className="block text-xs font-medium text-[#171B19]">
                    Contact info (optional)
                  </label>
                  <input
                    id="pt-contact"
                    type="text"
                    value={ptContact}
                    onChange={(e) => setPtContact(e.target.value)}
                    placeholder="pilot@kiln.org.ng"
                    className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  />
                </div>

                <div>
                  <label htmlFor="pt-status" className="block text-xs font-medium text-[#171B19]">
                    Status
                  </label>
                  <select
                    id="pt-status"
                    value={ptStatus}
                    onChange={(e) => setPtStatus(e.target.value)}
                    className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  >
                    <option value="DEMO">DEMO (Selectable for testing)</option>
                    <option value="ACTIVE">ACTIVE (Live drop-off)</option>
                    <option value="PLANNED">PLANNED (Not yet open)</option>
                    <option value="INACTIVE">INACTIVE (Hidden)</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={busyId === 'create-point'}
                className="min-h-[44px] px-5 py-2 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
              >
                {busyId === 'create-point' ? 'Saving...' : 'Save Collection Point'}
              </button>
            </form>
          )}

          <div className="bg-white border border-[#DAD7CE] rounded-sm divide-y divide-[#E6E3DA]">
            {points.map((pt) => (
              <div
                key={pt.id}
                className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center text-sm"
              >
                <div className="lg:col-span-5">
                  <p className="font-semibold text-[#171B19]">{pt.name}</p>
                  <p className="text-xs text-[#59605B] mt-0.5">
                    {pt.communityArea} · {pt.operatingHours}
                  </p>
                </div>
                <div className="lg:col-span-4 text-xs text-[#3F4541]">{pt.address}</div>
                <div className="lg:col-span-3 flex items-center lg:justify-end gap-2">
                  <label htmlFor={`pt-status-${pt.id}`} className="sr-only">
                    Status for {pt.name}
                  </label>
                  <select
                    id={`pt-status-${pt.id}`}
                    disabled={busyId === `point-${pt.id}`}
                    value={pt.status}
                    onChange={(e) => handleUpdatePointStatus(pt, e.target.value)}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="DEMO">DEMO</option>
                    <option value="PLANNED">PLANNED</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* STAGE 4: REWARDS & REDEMPTIONS */}
      {tab === 'rewards' && (
        <section className="mt-6">
          <AdminRewardsRedemptionsPanel materials={materials} />
        </section>
      )}

      {/* STAGE 5: INVENTORY, BATCHES, TRANSFERS & SALES */}
      {tab === 'inventory' && (
        <section className="mt-6">
          <AdminInventoryPanel materials={materials} />
        </section>
      )}

      {/* STAGE 6 & 7: INTEGRATIONS & LEARNING */}
      {tab === 'integrations' && (
        <section className="mt-6">
          <AdminIntegrationsLearningPanel />
        </section>
      )}

      {/* STAGE 8: USERS, MATERIALS, REPORTS, CSV EXPORTS & AUDIT */}
      {tab === 'governance' && (
        <section className="mt-6">
          <AdminUsersReportsPanel onMaterialsChanged={loadAdminData} />
        </section>
      )}
    </main>
  );
}
