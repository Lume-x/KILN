import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Scale, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  AppRoute,
  CollectionRequestRecord,
  MaterialCategory,
  QualityGrade,
} from '../types/kiln';
import {
  QUALITY_GRADE_LABELS,
  STATUS_META,
  formatDateTime,
  formatMethodLabel,
  readImageFileAsDataUrl,
} from '../lib/status-labels';

interface AgentDashboardPageProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
}

type AgentFilter = 'ACTION_NEEDED' | 'AWAITING_VERIFICATION' | 'COMPLETED' | 'ALL';

export function AgentDashboardPage({ onNavigate }: AgentDashboardPageProps) {
  const { user, loading: authLoading, authFetch } = useAuth();

  const [assignments, setAssignments] = useState<CollectionRequestRecord[]>([]);
  const [materials, setMaterials] = useState<MaterialCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<AgentFilter>('ACTION_NEEDED');

  // Inline decline prompt state
  const [decliningRequestId, setDecliningRequestId] = useState<number | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  // Inline weight recording form state
  const [weighingRequestId, setWeighingRequestId] = useState<number | null>(null);
  const [weightCategoryId, setWeightCategoryId] = useState<string>('');
  const [actualWeightKg, setActualWeightKg] = useState('');
  const [rejectedWeightKg, setRejectedWeightKg] = useState('0.00');
  const [eligibleWeightKg, setEligibleWeightKg] = useState('');
  const [eligibleManualOverride, setEligibleManualOverride] = useState(false);
  const [qualityGrade, setQualityGrade] = useState<QualityGrade>('A_CLEAN');
  const [contaminationNotes, setContaminationNotes] = useState('');
  const [agentNotes, setAgentNotes] = useState('');
  const [evidencePhotoUrl, setEvidencePhotoUrl] = useState<string | null>(null);
  const [evidenceFileName, setEvidenceFileName] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      onNavigate('/login');
    }
  }, [authLoading, user, onNavigate]);

  const loadAgentData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignRes, matRes] = await Promise.all([
        authFetch('/api/agent/assignments'),
        fetch('/api/public/materials'),
      ]);

      if (assignRes.status === 403) {
        throw new Error('This workspace is restricted to authorised KILN collection agents.');
      }
      if (!assignRes.ok) {
        const d = await assignRes.json().catch(() => ({}));
        throw new Error(d.error || 'Could not load assigned collections.');
      }

      const [assignData, matData] = await Promise.all([
        assignRes.json(),
        matRes.ok ? matRes.json() : Promise.resolve({ materials: [] }),
      ]);

      setAssignments(Array.isArray(assignData.assignments) ? assignData.assignments : []);
      setMaterials(Array.isArray(matData.materials) ? matData.materials : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load agent dashboard.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (user && (user.role === 'AGENT' || user.role === 'ADMIN')) {
      loadAgentData();
    } else if (user) {
      setLoading(false);
    }
  }, [user, loadAgentData]);

  // Auto-calculate eligible = actual - rejected unless agent manually typed eligible
  useEffect(() => {
    if (eligibleManualOverride) return;
    const actualNum = Number(actualWeightKg);
    const rejectedNum = Number(rejectedWeightKg || '0');
    if (Number.isFinite(actualNum) && actualNum >= 0 && Number.isFinite(rejectedNum) && rejectedNum >= 0) {
      const diff = Math.max(0, Math.round((actualNum - rejectedNum) * 100) / 100);
      setEligibleWeightKg(actualWeightKg ? diff.toFixed(2) : '');
    }
  }, [actualWeightKg, rejectedWeightKg, eligibleManualOverride]);

  const summary = useMemo(() => {
    let pendingResponse = 0;
    let activeField = 0;
    let awaitingVerification = 0;
    let verified = 0;

    for (const item of assignments) {
      if (item.status === 'ASSIGNED') pendingResponse += 1;
      else if (
        item.status === 'ACCEPTED_BY_AGENT' ||
        item.status === 'IN_PROGRESS' ||
        item.status === 'COLLECTED'
      ) {
        activeField += 1;
      } else if (item.status === 'AWAITING_VERIFICATION') awaitingVerification += 1;
      else if (item.status === 'VERIFIED') verified += 1;
    }

    return { pendingResponse, activeField, awaitingVerification, verified };
  }, [assignments]);

  const visibleAssignments = useMemo(() => {
    return assignments.filter((item) => {
      if (filter === 'ALL') return true;
      if (filter === 'AWAITING_VERIFICATION') return item.status === 'AWAITING_VERIFICATION';
      if (filter === 'COMPLETED') return item.status === 'VERIFIED' || item.status === 'REJECTED';
      return (
        item.status === 'ASSIGNED' ||
        item.status === 'ACCEPTED_BY_AGENT' ||
        item.status === 'IN_PROGRESS' ||
        item.status === 'COLLECTED'
      );
    });
  }, [assignments, filter]);

  function openWeightForm(req: CollectionRequestRecord) {
    setWeighingRequestId(req.id);
    setWeightCategoryId(String(req.materialCategoryId));
    setActualWeightKg(req.estimatedWeightKg);
    setRejectedWeightKg('0.00');
    setEligibleWeightKg(req.estimatedWeightKg);
    setEligibleManualOverride(false);
    setQualityGrade('A_CLEAN');
    setContaminationNotes('');
    setAgentNotes('');
    setEvidencePhotoUrl(null);
    setEvidenceFileName(null);
    setError(null);
  }

  async function handleRespond(
    req: CollectionRequestRecord,
    decision: 'ACCEPT' | 'REJECT',
    note?: string
  ) {
    if (!req.activeAssignment) return;
    setBusyId(req.id);
    setError(null);
    setActionNotice(null);
    try {
      const res = await authFetch(`/api/agent/assignments/${req.activeAssignment.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not record assignment response.');
      }

      if (decision === 'REJECT') {
        setAssignments((prev) => prev.filter((item) => item.id !== req.id));
        setDecliningRequestId(null);
        setDeclineNote('');
        setActionNotice(`Assignment for ${req.referenceCode} declined and returned to coordinator.`);
      } else {
        setAssignments((prev) => prev.map((item) => (item.id === req.id ? data.request : item)));
        setActionNotice(`Accepted assignment ${req.referenceCode}. Ready for collection.`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to respond to assignment.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleProgress(
    req: CollectionRequestRecord,
    nextStatus: 'IN_PROGRESS' | 'COLLECTED'
  ) {
    if (!req.activeAssignment) return;
    setBusyId(req.id);
    setError(null);
    setActionNotice(null);
    try {
      const res = await authFetch(`/api/agent/assignments/${req.activeAssignment.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not update collection status.');
      }
      setAssignments((prev) => prev.map((item) => (item.id === req.id ? data.request : item)));
      setActionNotice(
        nextStatus === 'IN_PROGRESS'
          ? `Started collection for ${req.referenceCode}.`
          : `Marked ${req.referenceCode} as collected. Record physical weight below.`
      );
      if (nextStatus === 'COLLECTED') {
        openWeightForm(data.request);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update collection progress.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleEvidencePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setEvidencePhotoUrl(null);
      setEvidenceFileName(null);
      return;
    }
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setEvidencePhotoUrl(dataUrl);
      setEvidenceFileName(file.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid evidence photograph.');
    }
  }

  async function handleSubmitWeight(e: React.FormEvent, req: CollectionRequestRecord) {
    e.preventDefault();
    if (!req.activeAssignment) return;
    setBusyId(req.id);
    setError(null);
    setActionNotice(null);
    try {
      const res = await authFetch(`/api/agent/assignments/${req.activeAssignment.id}/weight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialCategoryId: Number(weightCategoryId),
          actualWeightKg,
          rejectedWeightKg,
          eligibleWeightKg,
          qualityGrade,
          contaminationNotes,
          agentNotes,
          evidencePhotoUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not submit physical weight record.');
      }
      setAssignments((prev) => prev.map((item) => (item.id === req.id ? data.request : item)));
      setWeighingRequestId(null);
      setActionNotice(
        `Weight record submitted for ${req.referenceCode}. Now awaiting administrator verification.`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to submit weight record.');
    } finally {
      setBusyId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <p className="text-sm text-[#59605B]">Loading agent dashboard...</p>
      </main>
    );
  }

  if (user.role !== 'AGENT' && user.role !== 'ADMIN') {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-lg bg-white border border-[#DAD7CE] rounded-sm p-8">
          <h1 className="font-display text-2xl font-semibold text-[#171B19]">
            Collection Agent Access Required
          </h1>
          <p className="mt-2 text-sm text-[#3F4541]">
            Your account role ({user.role}) does not have access to field collection assignments.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('/collections')}
            className="mt-5 min-h-[44px] px-5 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] rounded-sm cursor-pointer"
          >
            Go to Participant Collections
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
      <div className="pb-6 border-b border-[#DAD7CE] flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#59605B]">
            Field Collection Desk · {user.fullName}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-[#171B19]">
            Agent Assignments
          </h1>
          <p className="mt-1 text-sm text-[#3F4541]">
            Accept assigned requests, update collection progress on site, and record physical scale
            weights for verification.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAgentData}
          className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#17372D] border border-[#17372D] hover:bg-[#EFECE4] rounded-sm self-start sm:self-auto cursor-pointer"
        >
          Refresh Queue
        </button>
      </div>

      {/* Mobile-friendly 4-stat bar */}
      <section className="mt-6 grid grid-cols-2 lg:grid-cols-4 border border-[#DAD7CE] bg-white rounded-sm divide-y lg:divide-y-0 sm:divide-x divide-[#DAD7CE]">
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Pending response</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#8A4E11] tabular-nums">
            {summary.pendingResponse}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Active collections</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
            {summary.activeField}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Awaiting admin verification</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#8A4E11] tabular-nums">
            {summary.awaitingVerification}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs text-[#59605B]">Verified completed</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-[#14532D] tabular-nums">
            {summary.verified}
          </p>
        </div>
      </section>

      {actionNotice && (
        <div
          role="status"
          className="mt-5 p-4 bg-[#EEF4F0] border border-[#17372D] rounded-sm text-sm text-[#171B19] flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 text-[#17372D] shrink-0" aria-hidden="true" />
          <span>{actionNotice}</span>
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

      {/* Filter Tabs */}
      <div className="mt-6 flex flex-wrap items-center gap-1 p-1 bg-[#E5E2D9] rounded-sm w-fit">
        {(
          [
            ['ACTION_NEEDED', 'Action Needed'],
            ['AWAITING_VERIFICATION', 'Awaiting Verification'],
            ['COMPLETED', 'Completed'],
            ['ALL', 'All Assignments'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`min-h-[40px] px-3.5 py-1.5 text-xs font-medium rounded-sm cursor-pointer whitespace-nowrap ${
              filter === key
                ? 'bg-[#17372D] text-[#F7F6F2]'
                : 'text-[#3F4541] hover:text-[#171B19]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Assignments Stack (Mobile-first generous cards with >=44px controls) */}
      <section className="mt-6 space-y-5">
        {loading ? (
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 animate-pulse space-y-3">
            <div className="h-6 bg-[#EFECE4] w-1/3" />
            <div className="h-4 bg-[#EFECE4] w-2/3" />
          </div>
        ) : visibleAssignments.length === 0 ? (
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-8 text-center">
            <h2 className="font-display text-xl font-semibold text-[#171B19]">
              No assignments in this queue
            </h2>
            <p className="mt-2 text-sm text-[#59605B]">
              Assigned pickup and drop-off tasks from the KILN administrator will appear here.
            </p>
          </div>
        ) : (
          visibleAssignments.map((req) => {
            const meta = STATUS_META[req.status];
            const isBusy = busyId === req.id;
            const isWeighing = weighingRequestId === req.id;
            const isDeclining = decliningRequestId === req.id;

            return (
              <article
                key={req.id}
                className="bg-white border border-[#DAD7CE] rounded-sm p-5 sm:p-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-[#E6E3DA]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#59605B]">
                      <span className="font-mono font-semibold text-[#171B19]">
                        {req.referenceCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatMethodLabel(req.collectionMethod)}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-semibold ${meta.textClass}`}>{meta.label}</span>
                    </div>
                    <h2 className="mt-1.5 font-display text-xl font-semibold text-[#171B19]">
                      {req.materialName} —{' '}
                      <span className="font-mono tabular-nums">{req.estimatedWeightKg} kg</span>{' '}
                      <span className="text-sm font-normal text-[#59605B]">(estimated)</span>
                    </h2>
                  </div>

                  <p className="text-xs text-[#59605B] font-mono tabular-nums">
                    {req.activeAssignment
                      ? `Assigned ${formatDateTime(req.activeAssignment.assignedAt)}`
                      : formatDateTime(req.createdAt)}
                  </p>
                </div>

                {/* Participant & Location Details */}
                <dl className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-[#59605B]">Participant</dt>
                    <dd className="mt-0.5 font-medium text-[#171B19]">{req.userName}</dd>
                    {req.userPhone && (
                      <dd className="text-xs font-mono text-[#3F4541]">{req.userPhone}</dd>
                    )}
                  </div>

                  <div>
                    <dt className="text-xs text-[#59605B]">
                      {req.collectionMethod === 'PICKUP' ? 'Pickup location' : 'Drop-off point'}
                    </dt>
                    <dd className="mt-0.5 text-[#171B19]">
                      {req.collectionMethod === 'PICKUP'
                        ? `${req.pickupAddress} (${req.communityArea})`
                        : req.collectionPointName}
                    </dd>
                    {req.landmarksDirections && (
                      <dd className="text-xs text-[#59605B] mt-0.5">
                        Landmark: {req.landmarksDirections}
                      </dd>
                    )}
                  </div>

                  <div>
                    <dt className="text-xs text-[#59605B]">Preferred window</dt>
                    <dd className="mt-0.5 text-[#171B19]">{req.preferredWindow}</dd>
                    {req.notes && (
                      <dd className="text-xs text-[#59605B] mt-0.5">Note: {req.notes}</dd>
                    )}
                  </div>
                </dl>

                {/* Recorded Weight Summary (when already submitted) */}
                {req.submission && (
                  <div className="mt-4 p-4 bg-[#F7F6F2] border border-[#E6E3DA] rounded-sm text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#171B19]">
                        Recorded Physical Weights
                      </span>
                      <span className="text-xs text-[#59605B]">
                        {QUALITY_GRADE_LABELS[req.submission.qualityGrade]}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-3 font-mono tabular-nums text-sm">
                      <div>
                        <span className="block font-sans text-xs text-[#59605B]">Actual</span>
                        <strong>{req.submission.actualWeightKg} kg</strong>
                      </div>
                      <div>
                        <span className="block font-sans text-xs text-[#59605B]">Rejected</span>
                        <strong className="text-[#8A4E11]">
                          {req.submission.rejectedWeightKg} kg
                        </strong>
                      </div>
                      <div>
                        <span className="block font-sans text-xs text-[#59605B]">Eligible</span>
                        <strong className="text-[#14532D]">
                          {req.submission.eligibleWeightKg} kg
                        </strong>
                      </div>
                    </div>
                    {req.verification && (
                      <p className="mt-2 pt-2 border-t border-[#E6E3DA] text-xs text-[#3F4541]">
                        Admin verification:{' '}
                        <strong
                          className={
                            req.verification.decision === 'APPROVED'
                              ? 'text-[#14532D]'
                              : 'text-[#991B1B]'
                          }
                        >
                          {req.verification.decision}
                        </strong>
                        {req.verification.reviewNotes ? ` — ${req.verification.reviewNotes}` : ''}
                      </p>
                    )}
                  </div>
                )}

                {/* Field Action Controls (Only for actual assigned agent) */}
                {user.role === 'AGENT' && (
                  <div className="mt-5 pt-4 border-t border-[#E6E3DA]">
                    {req.status === 'ASSIGNED' && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row gap-3">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleRespond(req, 'ACCEPT')}
                            className="min-h-[46px] px-5 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer disabled:opacity-60"
                          >
                            {isBusy ? 'Updating...' : 'Accept Assignment'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setDecliningRequestId(isDeclining ? null : req.id);
                              setDeclineNote('');
                            }}
                            className="min-h-[46px] px-5 py-2.5 text-sm font-medium text-[#991B1B] border border-[#E6B8B0] hover:bg-[#FDF2F0] rounded-sm cursor-pointer"
                          >
                            {isDeclining ? 'Cancel Decline' : 'Decline Assignment'}
                          </button>
                        </div>

                        {isDeclining && (
                          <div className="p-4 bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm space-y-3">
                            <label
                              htmlFor={`decline-${req.id}`}
                              className="block text-xs font-semibold text-[#7F2315]"
                            >
                              Reason for declining (sent to coordinator)
                            </label>
                            <input
                              id={`decline-${req.id}`}
                              type="text"
                              value={declineNote}
                              onChange={(e) => setDeclineNote(e.target.value)}
                              placeholder="e.g. Unavailable in Eziobodo during requested window"
                              className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-[#E6B8B0] rounded-sm"
                            />
                            <button
                              type="button"
                              disabled={isBusy || declineNote.trim().length < 3}
                              onClick={() => handleRespond(req, 'REJECT', declineNote)}
                              className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-[#991B1B] hover:bg-[#7F1D1D] disabled:opacity-50 rounded-sm cursor-pointer"
                            >
                              Confirm Decline
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {req.status === 'ACCEPTED_BY_AGENT' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleProgress(req, 'IN_PROGRESS')}
                        className="w-full sm:w-auto min-h-[46px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer disabled:opacity-60"
                      >
                        {isBusy ? 'Updating...' : 'Start Collection'}
                      </button>
                    )}

                    {req.status === 'IN_PROGRESS' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleProgress(req, 'COLLECTED')}
                        className="w-full sm:w-auto min-h-[46px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer disabled:opacity-60"
                      >
                        {isBusy ? 'Updating...' : 'Mark Materials Collected'}
                      </button>
                    )}

                    {req.status === 'COLLECTED' && !isWeighing && (
                      <button
                        type="button"
                        onClick={() => openWeightForm(req)}
                        className="w-full sm:w-auto min-h-[46px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm inline-flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Scale className="w-4 h-4" aria-hidden="true" />
                        <span>Record Physical Weight</span>
                      </button>
                    )}

                    {/* Physical Weight Recording Form */}
                    {req.status === 'COLLECTED' && isWeighing && (
                      <form
                        onSubmit={(e) => handleSubmitWeight(e, req)}
                        className="p-4 sm:p-5 bg-[#F7F6F2] border border-[#17372D] rounded-sm space-y-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-display text-lg font-semibold text-[#171B19]">
                            Record Physical Scale Weight
                          </h3>
                          <button
                            type="button"
                            onClick={() => setWeighingRequestId(null)}
                            className="text-xs font-medium text-[#59605B] underline cursor-pointer"
                          >
                            Close
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label
                              htmlFor={`wt-mat-${req.id}`}
                              className="block text-xs font-medium text-[#171B19]"
                            >
                              Verified material category
                            </label>
                            <select
                              id={`wt-mat-${req.id}`}
                              value={weightCategoryId}
                              onChange={(e) => setWeightCategoryId(e.target.value)}
                              className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-[#C9C5BA] rounded-sm"
                            >
                              {materials.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label
                              htmlFor={`wt-grade-${req.id}`}
                              className="block text-xs font-medium text-[#171B19]"
                            >
                              Quality grade
                            </label>
                            <select
                              id={`wt-grade-${req.id}`}
                              value={qualityGrade}
                              onChange={(e) => setQualityGrade(e.target.value as QualityGrade)}
                              className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-[#C9C5BA] rounded-sm"
                            >
                              {Object.entries(QUALITY_GRADE_LABELS).map(([val, label]) => (
                                <option key={val} value={val}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label
                              htmlFor={`wt-actual-${req.id}`}
                              className="block text-xs font-medium text-[#171B19]"
                            >
                              Actual total weight (kg)
                            </label>
                            <input
                              id={`wt-actual-${req.id}`}
                              type="number"
                              step="0.01"
                              min="0.01"
                              required
                              value={actualWeightKg}
                              onChange={(e) => {
                                setActualWeightKg(e.target.value);
                                setEligibleManualOverride(false);
                              }}
                              className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#C9C5BA] rounded-sm"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`wt-rejected-${req.id}`}
                              className="block text-xs font-medium text-[#171B19]"
                            >
                              Rejected weight (kg)
                            </label>
                            <input
                              id={`wt-rejected-${req.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              required
                              value={rejectedWeightKg}
                              onChange={(e) => {
                                setRejectedWeightKg(e.target.value);
                                setEligibleManualOverride(false);
                              }}
                              className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm font-mono tabular-nums bg-white border border-[#C9C5BA] rounded-sm"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`wt-eligible-${req.id}`}
                              className="block text-xs font-medium text-[#171B19]"
                            >
                              Eligible weight (kg)
                            </label>
                            <input
                              id={`wt-eligible-${req.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              required
                              value={eligibleWeightKg}
                              onChange={(e) => {
                                setEligibleManualOverride(true);
                                setEligibleWeightKg(e.target.value);
                              }}
                              className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm font-mono tabular-nums font-semibold text-[#14532D] bg-white border border-[#17372D] rounded-sm"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label
                              htmlFor={`wt-contam-${req.id}`}
                              className="block text-xs font-medium text-[#171B19]"
                            >
                              Contamination notes (optional)
                            </label>
                            <input
                              id={`wt-contam-${req.id}`}
                              type="text"
                              value={contaminationNotes}
                              onChange={(e) => setContaminationNotes(e.target.value)}
                              placeholder="e.g. Removed 0.40 kg wet bottles"
                              className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-[#C9C5BA] rounded-sm"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`wt-notes-${req.id}`}
                              className="block text-xs font-medium text-[#171B19]"
                            >
                              Agent remarks (optional)
                            </label>
                            <input
                              id={`wt-notes-${req.id}`}
                              type="text"
                              value={agentNotes}
                              onChange={(e) => setAgentNotes(e.target.value)}
                              placeholder="Scale reading verified with participant"
                              className="mt-1 w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-[#C9C5BA] rounded-sm"
                            />
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor={`wt-photo-${req.id}`}
                            className="inline-flex min-h-[44px] px-4 py-2 text-xs font-medium text-[#17372D] border border-[#17372D] bg-white hover:bg-[#EFECE4] rounded-sm items-center gap-2 cursor-pointer"
                          >
                            <Upload className="w-4 h-4" aria-hidden="true" />
                            <span>
                              {evidenceFileName
                                ? `Photo attached: ${evidenceFileName}`
                                : 'Attach Scale / Material Evidence Photo (Optional)'}
                            </span>
                          </label>
                          <input
                            id={`wt-photo-${req.id}`}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handleEvidencePhotoChange}
                            className="sr-only"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={isBusy}
                          className="w-full sm:w-auto min-h-[46px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm cursor-pointer"
                        >
                          {isBusy ? 'Submitting...' : 'Submit Weight for Admin Verification'}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
