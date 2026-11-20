import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, Upload, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  PILOT_COMMUNITY_AREAS,
  PREFERRED_COLLECTION_WINDOWS,
  type AppRoute,
  type CollectionMethod,
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
  readImageFileAsDataUrl,
} from '../lib/status-labels';

interface CollectionsPageProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
}

type HistoryFilter = 'ALL' | 'ACTIVE' | 'AWAITING_VERIFICATION' | 'VERIFIED' | 'CLOSED';

export function CollectionsPage({ onNavigate }: CollectionsPageProps) {
  const { user, loading: authLoading, authFetch } = useAuth();

  const [activeTab, setActiveTab] = useState<'history' | 'new'>('history');
  const [requests, setRequests] = useState<CollectionRequestRecord[]>([]);
  const [materials, setMaterials] = useState<MaterialCategory[]>([]);
  const [dropOffPoints, setDropOffPoints] = useState<CollectionPoint[]>([]);

  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<HistoryFilter>('ALL');
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // New Collection Request Form state
  const [materialCategoryId, setMaterialCategoryId] = useState<string>('');
  const [estimatedWeightKg, setEstimatedWeightKg] = useState<string>('');
  const [collectionMethod, setCollectionMethod] = useState<CollectionMethod>('PICKUP');
  const [communityArea, setCommunityArea] = useState<string>(PILOT_COMMUNITY_AREAS[0]);
  const [pickupAddress, setPickupAddress] = useState<string>('');
  const [landmarksDirections, setLandmarksDirections] = useState<string>('');
  const [collectionPointId, setCollectionPointId] = useState<string>('');
  const [preferredWindow, setPreferredWindow] = useState<string>(PREFERRED_COLLECTION_WINDOWS[0]);
  const [notes, setNotes] = useState<string>('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdBanner, setCreatedBanner] = useState<CollectionRequestRecord | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      onNavigate('/login');
    }
  }, [authLoading, user, onNavigate]);

  useEffect(() => {
    if (user) {
      setCommunityArea(user.communityArea || PILOT_COMMUNITY_AREAS[0]);
      if (user.address && !pickupAddress) {
        setPickupAddress(user.address);
      }
    }
  }, [user, pickupAddress]);

  const loadWorkspaceData = useCallback(async () => {
    setLoadingData(true);
    setLoadError(null);
    try {
      const [reqRes, matRes, ptRes] = await Promise.all([
        authFetch('/api/collections'),
        fetch('/api/public/materials'),
        authFetch('/api/collections/drop-off-points'),
      ]);

      if (!reqRes.ok) {
        const err = await reqRes.json().catch(() => ({}));
        throw new Error(err.error || 'Could not load your collection requests.');
      }

      const [reqData, matData, ptData] = await Promise.all([
        reqRes.json(),
        matRes.ok ? matRes.json() : Promise.resolve({ materials: [] }),
        ptRes.ok ? ptRes.json() : Promise.resolve({ collectionPoints: [] }),
      ]);

      const loadedRequests: CollectionRequestRecord[] = Array.isArray(reqData.requests)
        ? reqData.requests
        : [];
      const loadedMaterials: MaterialCategory[] = Array.isArray(matData.materials)
        ? matData.materials
        : [];
      const loadedPoints: CollectionPoint[] = Array.isArray(ptData.collectionPoints)
        ? ptData.collectionPoints
        : [];

      setRequests(loadedRequests);
      setMaterials(loadedMaterials);
      setDropOffPoints(loadedPoints);

      if (loadedMaterials.length > 0 && !materialCategoryId) {
        setMaterialCategoryId(String(loadedMaterials[0].id));
      }
      if (loadedPoints.length > 0 && !collectionPointId) {
        setCollectionPointId(String(loadedPoints[0].id));
      }
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load collection workspace.');
    } finally {
      setLoadingData(false);
    }
  }, [authFetch, materialCategoryId, collectionPointId]);

  useEffect(() => {
    if (user) {
      loadWorkspaceData();
    }
  }, [user, loadWorkspaceData]);

  const selectedMaterial = useMemo(
    () => materials.find((m) => String(m.id) === materialCategoryId) ?? null,
    [materials, materialCategoryId]
  );

  const selectedDropOffPoint = useMemo(
    () => dropOffPoints.find((p) => String(p.id) === collectionPointId) ?? null,
    [dropOffPoints, collectionPointId]
  );

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter === 'ALL') return true;
      if (statusFilter === 'VERIFIED') return r.status === 'VERIFIED';
      if (statusFilter === 'AWAITING_VERIFICATION') return r.status === 'AWAITING_VERIFICATION';
      if (statusFilter === 'CLOSED') return r.status === 'CANCELLED' || r.status === 'REJECTED';
      return (
        r.status === 'PENDING' ||
        r.status === 'APPROVED' ||
        r.status === 'ASSIGNED' ||
        r.status === 'ACCEPTED_BY_AGENT' ||
        r.status === 'IN_PROGRESS' ||
        r.status === 'COLLECTED'
      );
    });
  }, [requests, statusFilter]);

  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === selectedRequestId) ?? null,
    [requests, selectedRequestId]
  );

  const summary = useMemo(() => {
    let activeCount = 0;
    let verifiedCount = 0;
    let verifiedCentigrams = 0;

    for (const req of requests) {
      if (req.status === 'VERIFIED' && req.verification?.decision === 'APPROVED') {
        verifiedCount += 1;
        const [w, f = '00'] = req.verification.verifiedEligibleWeightKg.split('.');
        verifiedCentigrams += Number(w) * 100 + Number((f + '00').slice(0, 2));
      } else if (req.status !== 'CANCELLED' && req.status !== 'REJECTED') {
        activeCount += 1;
      }
    }

    const totalKg = `${Math.floor(verifiedCentigrams / 100)}.${String(
      verifiedCentigrams % 100
    ).padStart(2, '0')}`;

    return {
      total: requests.length,
      active: activeCount,
      verified: verifiedCount,
      verifiedKg: totalKg,
    };
  }, [requests]);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFormError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setPhotoDataUrl(null);
      setPhotoFileName(null);
      return;
    }
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setPhotoDataUrl(dataUrl);
      setPhotoFileName(file.name);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Invalid photo selected.');
      setPhotoDataUrl(null);
      setPhotoFileName(null);
    }
  }

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreatedBanner(null);
    setSubmitting(true);

    try {
      const payload = {
        materialCategoryId: Number(materialCategoryId),
        estimatedWeightKg,
        collectionMethod,
        communityArea,
        pickupAddress: collectionMethod === 'PICKUP' ? pickupAddress : undefined,
        landmarksDirections: collectionMethod === 'PICKUP' ? landmarksDirections : undefined,
        collectionPointId: collectionMethod === 'DROP_OFF' ? Number(collectionPointId) : undefined,
        preferredWindow,
        notes,
        photoDataUrl,
      };

      const res = await authFetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not submit your collection request.');
      }

      const created: CollectionRequestRecord = data.request;
      setRequests((prev) => [created, ...prev]);
      setCreatedBanner(created);
      setSelectedRequestId(created.id);
      setActiveTab('history');
      setStatusFilter('ALL');

      // Reset form inputs
      setEstimatedWeightKg('');
      setLandmarksDirections('');
      setNotes('');
      setPhotoDataUrl(null);
      setPhotoFileName(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not create collection request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelRequest(requestId: number) {
    setCancellingId(requestId);
    setLoadError(null);
    try {
      const res = await authFetch(`/api/collections/${requestId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by participant' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to cancel this request.');
      }
      setRequests((prev) => prev.map((r) => (r.id === requestId ? data.request : r)));
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Could not cancel request.');
    } finally {
      setCancellingId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <p className="text-sm text-[#59605B]">Loading your collection workspace...</p>
      </main>
    );
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-8 border-b border-[#DAD7CE]">
        <div>
          <p className="text-xs font-medium text-[#59605B]">
            Participant Recycling Workspace · {user.communityArea}
          </p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
            Collection Requests
          </h1>
          <p className="mt-1.5 text-sm text-[#3F4541]">
            Schedule a pickup or approved drop-off, track inspection progress, and review verified
            weights.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setActiveTab(activeTab === 'new' ? 'history' : 'new');
            setFormError(null);
          }}
          className="min-h-[44px] px-5 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm inline-flex items-center justify-center gap-2 self-start sm:self-auto cursor-pointer whitespace-nowrap"
        >
          {activeTab === 'new' ? (
            <span>View My History</span>
          ) : (
            <>
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Request Collection</span>
            </>
          )}
        </button>
      </div>

      {/* Single-elevation Summary Metrics Strip */}
      <section
        aria-label="Collection summary"
        className="mt-6 grid grid-cols-2 lg:grid-cols-4 border border-[#DAD7CE] bg-white rounded-sm divide-y lg:divide-y-0 divide-x-0 sm:divide-x divide-[#DAD7CE]"
      >
        <div className="p-5">
          <p className="text-xs text-[#59605B]">Total requests</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
            {summary.total}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#59605B]">Active / in progress</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
            {summary.active}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#59605B]">Verified collections</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#17372D] tabular-nums">
            {summary.verified}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs text-[#59605B]">Verified eligible weight</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold text-[#17372D] tabular-nums">
            {summary.verifiedKg} kg
          </p>
        </div>
      </section>

      {createdBanner && (
        <div
          role="status"
          className="mt-6 p-4 sm:p-5 bg-[#EEF4F0] border border-[#17372D] rounded-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#17372D] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[#171B19]">
                Collection request submitted · Reference{' '}
                <span className="font-mono">{createdBanner.referenceCode}</span>
              </p>
              <p className="mt-0.5 text-sm text-[#3F4541]">
                {createdBanner.materialName} ({createdBanner.estimatedWeightKg} kg estimated) via{' '}
                {formatMethodLabel(createdBanner.collectionMethod)}. Your materials will be
                physically weighed during handover.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreatedBanner(null)}
            aria-label="Dismiss confirmation"
            className="text-xs font-medium text-[#17372D] underline self-end sm:self-center cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Workspace Mode Tabs */}
      <div className="mt-8 flex items-center gap-1 p-1 bg-[#E5E2D9] rounded-sm w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`min-h-[40px] px-4 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'history'
              ? 'bg-[#17372D] text-[#F7F6F2]'
              : 'text-[#3F4541] hover:text-[#171B19]'
          }`}
        >
          Collection History ({requests.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('new')}
          className={`min-h-[40px] px-4 py-1.5 text-sm font-medium rounded-sm transition-colors cursor-pointer whitespace-nowrap ${
            activeTab === 'new'
              ? 'bg-[#17372D] text-[#F7F6F2]'
              : 'text-[#3F4541] hover:text-[#171B19]'
          }`}
        >
          New Collection Request
        </button>
      </div>

      {activeTab === 'new' ? (
        <section className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold text-[#171B19]">
              Submit Recyclable Materials
            </h2>
            <p className="mt-1 text-sm text-[#59605B]">
              Choose your material category, estimated weight, and whether you want a scheduled
              pickup or drop-off at an approved pilot point.
            </p>

            {formError && (
              <div
                role="alert"
                className="mt-5 p-3.5 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm"
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateRequest} className="mt-6 space-y-5">
              {/* Material & Estimated Weight */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="req-material" className="block text-sm font-medium text-[#171B19]">
                    Material category
                  </label>
                  <select
                    id="req-material"
                    required
                    value={materialCategoryId}
                    onChange={(e) => setMaterialCategoryId(e.target.value)}
                    className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                  >
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="req-weight" className="block text-sm font-medium text-[#171B19]">
                    Estimated weight (kg)
                  </label>
                  <input
                    id="req-weight"
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="5000"
                    required
                    value={estimatedWeightKg}
                    onChange={(e) => setEstimatedWeightKg(e.target.value)}
                    placeholder="e.g. 4.50"
                    className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm font-mono tabular-nums bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                  />
                  <p className="mt-1 text-xs text-[#59605B]">
                    Estimate only. Final weight is verified physically on a scale.
                  </p>
                </div>
              </div>

              {/* Collection Method Toggle */}
              <fieldset>
                <legend className="text-sm font-medium text-[#171B19]">Collection method</legend>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCollectionMethod('PICKUP')}
                    className={`min-h-[48px] px-4 py-3 text-left border rounded-sm transition-colors cursor-pointer ${
                      collectionMethod === 'PICKUP'
                        ? 'border-[#17372D] bg-[#EEF4F0]'
                        : 'border-[#C9C5BA] bg-[#F7F6F2] hover:bg-[#EFECE4]'
                    }`}
                  >
                    <div className="text-sm font-semibold text-[#171B19]">Scheduled Pickup</div>
                    <div className="mt-0.5 text-xs text-[#59605B]">
                      An agent visits your hostel, home, or shop
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCollectionMethod('DROP_OFF')}
                    className={`min-h-[48px] px-4 py-3 text-left border rounded-sm transition-colors cursor-pointer ${
                      collectionMethod === 'DROP_OFF'
                        ? 'border-[#17372D] bg-[#EEF4F0]'
                        : 'border-[#C9C5BA] bg-[#F7F6F2] hover:bg-[#EFECE4]'
                    }`}
                  >
                    <div className="text-sm font-semibold text-[#171B19]">Approved Drop-Off</div>
                    <div className="mt-0.5 text-xs text-[#59605B]">
                      Bring sorted materials to a pilot collection point
                    </div>
                  </button>
                </div>
              </fieldset>

              {collectionMethod === 'PICKUP' ? (
                <div className="space-y-4 pt-2 border-t border-[#E6E3DA]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="req-area" className="block text-sm font-medium text-[#171B19]">
                        Community area
                      </label>
                      <select
                        id="req-area"
                        value={communityArea}
                        onChange={(e) => setCommunityArea(e.target.value)}
                        className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                      >
                        {PILOT_COMMUNITY_AREAS.map((area) => (
                          <option key={area} value={area}>
                            {area}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="req-window" className="block text-sm font-medium text-[#171B19]">
                        Preferred collection window
                      </label>
                      <select
                        id="req-window"
                        value={preferredWindow}
                        onChange={(e) => setPreferredWindow(e.target.value)}
                        className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                      >
                        {PREFERRED_COLLECTION_WINDOWS.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="req-address" className="block text-sm font-medium text-[#171B19]">
                      Pickup address (hostel, lodge, street, or shop)
                    </label>
                    <input
                      id="req-address"
                      type="text"
                      required
                      value={pickupAddress}
                      onChange={(e) => setPickupAddress(e.target.value)}
                      placeholder="e.g. Room 204, Divine Grace Lodge, Ihiagwa"
                      className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="req-landmarks"
                      className="block text-sm font-medium text-[#171B19]"
                    >
                      Directions or nearby landmarks{' '}
                      <span className="text-[#59605B] font-normal">(recommended)</span>
                    </label>
                    <input
                      id="req-landmarks"
                      type="text"
                      value={landmarksDirections}
                      onChange={(e) => setLandmarksDirections(e.target.value)}
                      placeholder="e.g. Second junction after FUTO Market Square"
                      className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4 pt-2 border-t border-[#E6E3DA]">
                  <div>
                    <label htmlFor="req-point" className="block text-sm font-medium text-[#171B19]">
                      Select collection point
                    </label>
                    {dropOffPoints.length === 0 ? (
                      <p className="mt-1.5 text-sm text-[#8A4E11]">
                        No drop-off collection points are currently active. Please use Scheduled
                        Pickup instead.
                      </p>
                    ) : (
                      <select
                        id="req-point"
                        required
                        value={collectionPointId}
                        onChange={(e) => setCollectionPointId(e.target.value)}
                        className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                      >
                        {dropOffPoints.map((pt) => (
                          <option key={pt.id} value={pt.id}>
                            {pt.name} — {pt.communityArea} ({pt.status})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {selectedDropOffPoint && (
                    <div className="p-4 bg-[#EFECE4] border border-[#DAD7CE] rounded-sm text-sm space-y-1.5">
                      <p className="font-semibold text-[#171B19]">
                        {selectedDropOffPoint.name} · {selectedDropOffPoint.status}
                      </p>
                      <p className="text-[#3F4541]">{selectedDropOffPoint.address}</p>
                      <p className="text-xs text-[#59605B]">
                        Hours: {selectedDropOffPoint.operatingHours}
                        {selectedDropOffPoint.contactInfo
                          ? ` · Contact: ${selectedDropOffPoint.contactInfo}`
                          : ''}
                      </p>
                      {selectedDropOffPoint.isDemo && (
                        <p className="text-xs text-[#8A4E11]">
                          Demonstration pilot point for Stage 3 workflow testing — not yet a live
                          walk-in booth.
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="req-dropoff-window"
                      className="block text-sm font-medium text-[#171B19]"
                    >
                      Preferred drop-off window
                    </label>
                    <select
                      id="req-dropoff-window"
                      value={preferredWindow}
                      onChange={(e) => setPreferredWindow(e.target.value)}
                      className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                    >
                      {PREFERRED_COLLECTION_WINDOWS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Optional Photo & Notes */}
              <div className="space-y-4 pt-2 border-t border-[#E6E3DA]">
                <div>
                  <label htmlFor="req-photo" className="block text-sm font-medium text-[#171B19]">
                    Material photograph{' '}
                    <span className="text-[#59605B] font-normal">(optional · JPEG/PNG/WebP, max 2 MB)</span>
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3">
                    <label
                      htmlFor="req-photo"
                      className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#17372D] border border-[#17372D] hover:bg-[#EFECE4] rounded-sm inline-flex items-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-4 h-4" aria-hidden="true" />
                      <span>{photoFileName ? 'Replace Photo' : 'Attach Photo'}</span>
                    </label>
                    <input
                      id="req-photo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handlePhotoChange}
                      className="sr-only"
                    />
                    {photoFileName && (
                      <div className="flex items-center gap-2 text-xs text-[#3F4541]">
                        <span>{photoFileName}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoDataUrl(null);
                            setPhotoFileName(null);
                          }}
                          className="text-[#991B1B] underline cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                  {photoDataUrl && (
                    <img
                      src={photoDataUrl}
                      alt="Selected recyclable material preview"
                      className="mt-3 w-40 h-28 object-cover border border-[#DAD7CE] rounded-sm"
                    />
                  )}
                </div>

                <div>
                  <label htmlFor="req-notes" className="block text-sm font-medium text-[#171B19]">
                    Notes for collection agent{' '}
                    <span className="text-[#59605B] font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="req-notes"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Packed in two rice sacks, bottles are rinsed and flattened."
                    className="mt-1.5 w-full px-3.5 py-2.5 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                  />
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-4">
                <button
                  type="submit"
                  disabled={submitting || (collectionMethod === 'DROP_OFF' && dropOffPoints.length === 0)}
                  className="min-h-[46px] px-6 py-3 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm cursor-pointer"
                >
                  {submitting ? 'Submitting request...' : 'Submit Collection Request'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#3F4541] hover:text-[#171B19] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>

          {/* Preparation Reminder Sidebar */}
          <aside className="lg:col-span-4 bg-[#EFECE4] border border-[#DAD7CE] rounded-sm p-6 space-y-4">
            <p className="text-xs font-medium text-[#59605B]">Preparation Checklist</p>
            {selectedMaterial ? (
              <>
                <h3 className="font-display text-xl font-semibold text-[#171B19]">
                  {selectedMaterial.name}
                </h3>
                <div className="space-y-3 text-sm leading-relaxed">
                  <div>
                    <p className="font-semibold text-[#17372D]">Accepted</p>
                    <p className="text-[#3F4541]">{selectedMaterial.acceptanceInfo}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#171B19]">Preparation</p>
                    <p className="text-[#3F4541]">{selectedMaterial.preparationRequirements}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-[#8A4E11]">Avoid contamination</p>
                    <p className="text-[#59605B]">{selectedMaterial.contaminationRules}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-[#59605B]">
                Select a material category to review preparation requirements before packing.
              </p>
            )}
          </aside>
        </section>
      ) : (
        /* COLLECTION HISTORY + INSPECTOR */
        <section className="mt-6">
          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#E5E2D9] rounded-sm">
              {(
                [
                  ['ALL', 'All'],
                  ['ACTIVE', 'Active'],
                  ['AWAITING_VERIFICATION', 'Awaiting Verification'],
                  ['VERIFIED', 'Verified'],
                  ['CLOSED', 'Closed'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-sm cursor-pointer whitespace-nowrap ${
                    statusFilter === key
                      ? 'bg-white text-[#171B19]'
                      : 'text-[#3F4541] hover:text-[#171B19]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loadError && (
            <div
              role="alert"
              className="mb-4 p-4 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm"
            >
              {loadError}
            </div>
          )}

          {loadingData ? (
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 space-y-3 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 bg-[#EFECE4] rounded-sm" />
              ))}
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-10 text-center">
              <h2 className="font-display text-xl font-semibold text-[#171B19]">
                No collection requests in this view yet
              </h2>
              <p className="mt-2 text-sm text-[#59605B] max-w-md mx-auto">
                Sort your plastic bottles, aluminium cans, paper, or cardboard and submit your first
                pickup or drop-off request to receive a tracking reference code.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('new')}
                className="mt-5 min-h-[44px] px-5 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
              >
                Create First Collection Request
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* List / Table */}
              <div
                className={`${
                  selectedRequest ? 'lg:col-span-7' : 'lg:col-span-12'
                } bg-white border border-[#DAD7CE] rounded-sm overflow-hidden`}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[#DAD7CE] bg-[#F7F6F2] text-xs font-medium text-[#59605B]">
                        <th className="py-3 px-4">Reference</th>
                        <th className="py-3 px-4">Material</th>
                        <th className="py-3 px-4">Method</th>
                        <th className="py-3 px-4 text-right">Est. kg</th>
                        <th className="py-3 px-4 text-right">Verified kg</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E3DA]">
                      {filteredRequests.map((req) => {
                        const meta = STATUS_META[req.status];
                        const isSelected = selectedRequestId === req.id;
                        return (
                          <tr
                            key={req.id}
                            className={`transition-colors ${
                              isSelected ? 'bg-[#EEF4F0]/70' : 'hover:bg-[#F7F6F2]'
                            }`}
                          >
                            <td className="py-3.5 px-4 font-mono text-xs font-medium text-[#171B19] whitespace-nowrap">
                              {req.referenceCode}
                            </td>
                            <td className="py-3.5 px-4 font-medium text-[#171B19] whitespace-nowrap">
                              {req.materialName}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-[#3F4541] whitespace-nowrap">
                              {req.collectionMethod === 'PICKUP' ? 'Pickup' : 'Drop-Off'}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#3F4541]">
                              {req.estimatedWeightKg}
                            </td>
                            <td className="py-3.5 px-4 text-right font-mono tabular-nums font-medium text-[#17372D]">
                              {req.verification?.decision === 'APPROVED'
                                ? req.verification.verifiedEligibleWeightKg
                                : '—'}
                            </td>
                            <td
                              className={`py-3.5 px-4 text-xs font-semibold whitespace-nowrap ${meta.textClass}`}
                            >
                              {meta.label}
                            </td>
                            <td className="py-3.5 px-4 text-xs text-[#59605B] whitespace-nowrap font-mono tabular-nums">
                              {formatShortDate(req.createdAt)}
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedRequestId(isSelected ? null : req.id)
                                }
                                className="text-xs font-semibold text-[#17372D] underline underline-offset-4 cursor-pointer"
                              >
                                {isSelected ? 'Close' : 'Inspect'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Detail Inspector Panel */}
              {selectedRequest && (
                <aside className="lg:col-span-5 bg-white border border-[#DAD7CE] rounded-sm p-6 space-y-5">
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E6E3DA]">
                    <div>
                      <p className="font-mono text-xs text-[#59605B]">
                        {selectedRequest.referenceCode}
                      </p>
                      <h3 className="mt-1 font-display text-xl font-semibold text-[#171B19]">
                        {selectedRequest.materialName}
                      </h3>
                      <p
                        className={`mt-1 text-xs font-semibold ${
                          STATUS_META[selectedRequest.status].textClass
                        }`}
                      >
                        {STATUS_META[selectedRequest.status].label} ·{' '}
                        <span className="font-normal text-[#59605B]">
                          {STATUS_META[selectedRequest.status].summary}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedRequestId(null)}
                      aria-label="Close request inspector"
                      className="w-9 h-9 inline-flex items-center justify-center border border-[#DAD7CE] rounded-sm text-[#171B19] hover:bg-[#EFECE4] cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-[#59605B]">Collection method</dt>
                      <dd className="mt-0.5 font-medium text-[#171B19]">
                        {formatMethodLabel(selectedRequest.collectionMethod)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[#59605B]">Estimated weight</dt>
                      <dd className="mt-0.5 font-mono tabular-nums font-medium text-[#171B19]">
                        {selectedRequest.estimatedWeightKg} kg
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-[#59605B]">
                        {selectedRequest.collectionMethod === 'PICKUP'
                          ? 'Pickup location'
                          : 'Drop-off collection point'}
                      </dt>
                      <dd className="mt-0.5 text-[#3F4541]">
                        {selectedRequest.collectionMethod === 'PICKUP' ? (
                          <>
                            {selectedRequest.pickupAddress} ({selectedRequest.communityArea})
                            {selectedRequest.landmarksDirections && (
                              <span className="block text-xs text-[#59605B] mt-0.5">
                                Landmark: {selectedRequest.landmarksDirections}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {selectedRequest.collectionPointName}
                            {selectedRequest.collectionPointAddress && (
                              <span className="block text-xs text-[#59605B] mt-0.5">
                                {selectedRequest.collectionPointAddress}
                              </span>
                            )}
                          </>
                        )}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-[#59605B]">Preferred window</dt>
                      <dd className="mt-0.5 text-[#3F4541]">{selectedRequest.preferredWindow}</dd>
                    </div>
                    {selectedRequest.notes && (
                      <div className="col-span-2">
                        <dt className="text-xs text-[#59605B]">Your notes</dt>
                        <dd className="mt-0.5 text-[#3F4541]">{selectedRequest.notes}</dd>
                      </div>
                    )}
                    {selectedRequest.statusReason && (
                      <div className="col-span-2">
                        <dt className="text-xs text-[#59605B]">Status note</dt>
                        <dd className="mt-0.5 text-[#8A4E11]">{selectedRequest.statusReason}</dd>
                      </div>
                    )}
                  </dl>

                  {selectedRequest.photoDataUrl && (
                    <div className="pt-3 border-t border-[#E6E3DA]">
                      <p className="text-xs text-[#59605B] mb-2">Submitted material photo</p>
                      <img
                        src={selectedRequest.photoDataUrl}
                        alt="Submitted recyclable materials"
                        className="w-full max-h-48 object-cover border border-[#DAD7CE] rounded-sm"
                      />
                    </div>
                  )}

                  {selectedRequest.activeAssignment && (
                    <div className="pt-4 border-t border-[#E6E3DA] text-sm">
                      <p className="text-xs font-semibold text-[#171B19]">Assigned Agent</p>
                      <p className="mt-1 text-[#3F4541]">
                        {selectedRequest.activeAssignment.agentName} · Assignment{' '}
                        <span className="font-mono text-xs">
                          {selectedRequest.activeAssignment.status}
                        </span>
                      </p>
                      <p className="text-xs text-[#59605B] mt-0.5">
                        Assigned {formatDateTime(selectedRequest.activeAssignment.assignedAt)}
                      </p>
                    </div>
                  )}

                  {selectedRequest.submission && (
                    <div className="pt-4 border-t border-[#E6E3DA] space-y-2 text-sm">
                      <p className="text-xs font-semibold text-[#171B19]">
                        Physical Weighing Record
                      </p>
                      <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-xs bg-[#F7F6F2] p-3 border border-[#E6E3DA] rounded-sm">
                        <div>
                          <span className="text-[#59605B] block font-sans">Actual</span>
                          <span className="font-semibold text-[#171B19]">
                            {selectedRequest.submission.actualWeightKg} kg
                          </span>
                        </div>
                        <div>
                          <span className="text-[#59605B] block font-sans">Rejected</span>
                          <span className="font-semibold text-[#8A4E11]">
                            {selectedRequest.submission.rejectedWeightKg} kg
                          </span>
                        </div>
                        <div>
                          <span className="text-[#59605B] block font-sans">Eligible</span>
                          <span className="font-semibold text-[#14532D]">
                            {selectedRequest.submission.eligibleWeightKg} kg
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-[#3F4541]">
                        Quality:{' '}
                        {QUALITY_GRADE_LABELS[selectedRequest.submission.qualityGrade] ??
                          selectedRequest.submission.qualityGrade}
                      </p>
                      {selectedRequest.submission.contaminationNotes && (
                        <p className="text-xs text-[#8A4E11]">
                          Contamination note: {selectedRequest.submission.contaminationNotes}
                        </p>
                      )}
                    </div>
                  )}

                  {selectedRequest.verification && (
                    <div className="pt-4 border-t border-[#E6E3DA] space-y-2 text-sm">
                      <p className="text-xs font-semibold text-[#171B19]">
                        Administrator Verification
                      </p>
                      <p className="text-xs text-[#3F4541]">
                        Decision:{' '}
                        <strong
                          className={
                            selectedRequest.verification.decision === 'APPROVED'
                              ? 'text-[#14532D]'
                              : 'text-[#991B1B]'
                          }
                        >
                          {selectedRequest.verification.decision}
                        </strong>{' '}
                        · Verified Eligible Weight:{' '}
                        <span className="font-mono tabular-nums font-semibold">
                          {selectedRequest.verification.verifiedEligibleWeightKg} kg
                        </span>
                      </p>
                      {selectedRequest.verification.decision === 'APPROVED' && (
                        <div className="p-3 bg-[#EEF4F0] border border-[#B7CEC0] rounded-sm text-xs space-y-1">
                          <p className="font-semibold text-[#14532D] font-mono tabular-nums">
                            Reward Credited: +{selectedRequest.verification.pointsAwarded} pts
                          </p>
                          {selectedRequest.verification.appliedPointsPerKg && (
                            <p className="text-[#3F4541]">
                              Rate applied:{' '}
                              <span className="font-mono">
                                {selectedRequest.verification.appliedPointsPerKg} pts/kg
                              </span>
                              {selectedRequest.verification.appliedRateIsDemo ? ' (DEMO RATE)' : ''}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => onNavigate('/wallet')}
                            className="mt-1 text-xs font-semibold text-[#17372D] underline underline-offset-4 cursor-pointer"
                          >
                            View Reward in Wallet
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-[#59605B]">
                        Verified {formatDateTime(selectedRequest.verification.verifiedAt)}
                      </p>
                      {selectedRequest.verification.reviewNotes && (
                        <p className="text-xs text-[#3F4541]">
                          Notes: {selectedRequest.verification.reviewNotes}
                        </p>
                      )}
                    </div>
                  )}

                  {(selectedRequest.status === 'PENDING' ||
                    selectedRequest.status === 'APPROVED') && (
                    <div className="pt-4 border-t border-[#E6E3DA]">
                      <button
                        type="button"
                        disabled={cancellingId === selectedRequest.id}
                        onClick={() => handleCancelRequest(selectedRequest.id)}
                        className="min-h-[42px] px-4 py-2 text-xs font-semibold text-[#991B1B] border border-[#E6B8B0] hover:bg-[#FDF2F0] rounded-sm cursor-pointer disabled:opacity-60"
                      >
                        {cancellingId === selectedRequest.id
                          ? 'Cancelling...'
                          : 'Cancel Collection Request'}
                      </button>
                    </div>
                  )}
                </aside>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
