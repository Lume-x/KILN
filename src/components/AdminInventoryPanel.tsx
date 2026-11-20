import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PILOT_COMMUNITY_AREAS, type MaterialCategory } from '../types/kiln';
import { formatDateTime } from '../lib/status-labels';

interface StorageLocationRow {
  id: number;
  name: string;
  locationType: string;
  address: string;
  communityArea: string;
  description: string;
  capacityKg: string | null;
  isActive: boolean;
  isDemo: boolean;
  totalAvailableKg: string;
  activeBatchCount: number;
}

interface InventoryEntryRow {
  id: number;
  referenceCode: string;
  verificationId: number;
  collectionRequestId: number;
  collectionReference: string;
  materialCategoryId: number;
  materialName: string;
  storageLocationId: number;
  storageLocationName: string;
  qualityGrade: string;
  initialWeightKg: string;
  availableWeightKg: string;
  reservedWeightKg: string;
  status: string;
  createdAt: string;
}

interface BatchRow {
  id: number;
  batchReference: string;
  materialCategoryId: number;
  materialName: string;
  storageLocationId: number;
  storageLocationName: string;
  totalWeightKg: string;
  availableWeightKg: string;
  reservedWeightKg: string;
  status: string;
  notes: string | null;
  createdAt: string;
  sourceTraceability: Array<{
    inventoryEntryId: number;
    inventoryReference: string;
    collectionRequestId: number;
    collectionReference: string;
    verificationId: number;
    agentName: string;
    allocatedWeightKg: string;
  }>;
}

interface TransferRow {
  id: number;
  transferReference: string;
  batchId: number;
  batchReference: string;
  materialName: string;
  sourceLocationName: string;
  destinationLocationName: string;
  quantityKg: string;
  responsibleParty: string;
  status: string;
  createdAt: string;
}

interface SaleRow {
  id: number;
  saleReference: string;
  batchId: number;
  batchReference: string;
  materialName: string;
  buyerName: string;
  buyerContact: string | null;
  quantityKg: string;
  unitPriceNgn: string | null;
  totalValueNgn: string | null;
  transferStatus: string;
  paymentStatus: string;
  documentationRef: string | null;
  saleDate: string;
}

interface MovementRow {
  id: number;
  referenceCode: string;
  movementType: string;
  materialName: string;
  batchReference: string | null;
  fromLocationName: string | null;
  toLocationName: string | null;
  quantityDeltaKg: string;
  reason: string;
  createdAt: string;
}

export function AdminInventoryPanel({ materials }: { materials: MaterialCategory[] }) {
  const { authFetch } = useAuth();
  const [subTab, setSubTab] = useState<'stock' | 'batches' | 'transfers' | 'sales' | 'locations' | 'movements'>('stock');

  const [summary, setSummary] = useState<{
    totalUnbatchedKg: string;
    totalBatchedAvailableKg: string;
    totalSoldKg: string;
    activeBatchCount: number;
    byCategory: Array<{ name: string; unbatchedKg: string; batchedKg: string; soldKg: string }>;
  } | null>(null);
  const [entries, setEntries] = useState<InventoryEntryRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [locations, setLocations] = useState<StorageLocationRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);

  // Selection for batch creation & consolidation
  const [selectedEntryIds, setSelectedEntryIds] = useState<number[]>([]);
  const [batchLocationId, setBatchLocationId] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [selectedBatchIds, setSelectedBatchIds] = useState<number[]>([]);
  const [expandedBatchId, setExpandedBatchId] = useState<number | null>(null);

  // Transfer form
  const [trBatchId, setTrBatchId] = useState('');
  const [trDestLocId, setTrDestLocId] = useState('');
  const [trParty, setTrParty] = useState('');
  const [trNotes, setTrNotes] = useState('');

  // Sale form
  const [saleBatchId, setSaleBatchId] = useState('');
  const [saleBuyer, setSaleBuyer] = useState('');
  const [saleContact, setSaleContact] = useState('');
  const [saleQty, setSaleQty] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [saleDocRef, setSaleDocRef] = useState('');

  // New location form
  const [locName, setLocName] = useState('');
  const [locAddress, setLocAddress] = useState('');
  const [locArea, setLocArea] = useState<string>(PILOT_COMMUNITY_AREAS[0]);
  const [locDesc, setLocDesc] = useState('');
  const [locIsDemo, setLocIsDemo] = useState(true);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sumRes, entRes, batRes, locRes, trRes, saleRes, movRes] = await Promise.all([
        authFetch('/api/admin/inventory/summary'),
        authFetch('/api/admin/inventory/entries'),
        authFetch('/api/admin/inventory/batches'),
        authFetch('/api/admin/storage-locations'),
        authFetch('/api/admin/inventory/transfers'),
        authFetch('/api/admin/inventory/sales'),
        authFetch('/api/admin/inventory/movements?limit=80'),
      ]);
      const [sumD, entD, batD, locD, trD, saleD, movD] = await Promise.all([
        sumRes.ok ? sumRes.json() : Promise.resolve({ summary: null }),
        entRes.ok ? entRes.json() : Promise.resolve({ entries: [] }),
        batRes.ok ? batRes.json() : Promise.resolve({ batches: [] }),
        locRes.ok ? locRes.json() : Promise.resolve({ locations: [] }),
        trRes.ok ? trRes.json() : Promise.resolve({ transfers: [] }),
        saleRes.ok ? saleRes.json() : Promise.resolve({ sales: [] }),
        movRes.ok ? movRes.json() : Promise.resolve({ movements: [] }),
      ]);
      setSummary(sumD.summary ?? null);
      setEntries(Array.isArray(entD.entries) ? entD.entries : []);
      const bList: BatchRow[] = Array.isArray(batD.batches) ? batD.batches : [];
      setBatches(bList);
      const lList: StorageLocationRow[] = Array.isArray(locD.locations) ? locD.locations : [];
      setLocations(lList);
      setTransfers(Array.isArray(trD.transfers) ? trD.transfers : []);
      setSales(Array.isArray(saleD.sales) ? saleD.sales : []);
      setMovements(Array.isArray(movD.movements) ? movD.movements : []);

      if (lList.length > 0 && !batchLocationId) setBatchLocationId(String(lList[0].id));
      if (lList.length > 1 && !trDestLocId) setTrDestLocId(String(lList[1].id));
      const availBatch = bList.find((b) => Number(b.availableWeightKg) > 0 && b.status !== 'CONSOLIDATED' && b.status !== 'SOLD');
      if (availBatch && !trBatchId) setTrBatchId(String(availBatch.id));
      if (availBatch && !saleBatchId) setSaleBatchId(String(availBatch.id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load inventory data.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, batchLocationId, trDestLocId, trBatchId, saleBatchId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCreateBatch(e: React.FormEvent) {
    e.preventDefault();
    if (selectedEntryIds.length === 0) {
      setError('Select at least one available inventory entry.');
      return;
    }
    setBusy('create-batch');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/inventory/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventoryEntryIds: selectedEntryIds,
          storageLocationId: batchLocationId ? Number(batchLocationId) : undefined,
          notes: batchNotes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create batch.');
      setSelectedEntryIds([]);
      setBatchNotes('');
      setNotice(`Created batch ${data.batch.batchReference} (${data.batch.totalWeightKg} kg).`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Batch creation failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleConsolidateBatches() {
    if (selectedBatchIds.length < 2) {
      setError('Select at least 2 compatible batches of the same material to consolidate.');
      return;
    }
    setBusy('consolidate');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/inventory/batches/consolidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchIds: selectedBatchIds,
          storageLocationId: batchLocationId ? Number(batchLocationId) : undefined,
          notes: 'Consolidated into combined dispatch batch',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Consolidation failed.');
      setSelectedBatchIds([]);
      setNotice(
        `Consolidated into ${data.batch.batchReference} (${data.batch.totalWeightKg} kg) with full source traceability preserved.`
      );
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Consolidation failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateTransfer(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create-transfer');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/inventory/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: Number(trBatchId),
          destinationLocationId: Number(trDestLocId),
          responsibleParty: trParty,
          notes: trNotes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer creation failed.');
      setTrParty('');
      setTrNotes('');
      setNotice(`Transfer ${data.transfer.transferReference} created.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transfer error.');
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdateTransferStatus(transferId: number, status: string) {
    setBusy(`tr-${transferId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/inventory/transfers/${transferId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Transfer update failed.');
      setNotice(`Transfer ${data.transfer.transferReference} updated to ${status}.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transfer update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateSale(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create-sale');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/inventory/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId: Number(saleBatchId),
          buyerName: saleBuyer,
          buyerContact: saleContact || undefined,
          quantityKg: saleQty,
          unitPriceNgn: salePrice || undefined,
          documentationRef: saleDocRef || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sale recording failed.');
      setSaleBuyer('');
      setSaleContact('');
      setSaleQty('');
      setSalePrice('');
      setSaleDocRef('');
      setNotice(`Recorded sale ${data.sale.saleReference} (${data.sale.quantityKg} kg).`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sale failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdateSale(sale: SaleRow, patch: { transferStatus?: string; paymentStatus?: string }) {
    setBusy(`sale-${sale.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/inventory/sales/${sale.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update sale.');
      setNotice(`Sale ${sale.saleReference} updated.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sale update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateLocation(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create-loc');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/storage-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: locName,
          address: locAddress,
          communityArea: locArea,
          description: locDesc,
          isDemo: locIsDemo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create storage location.');
      setLocName('');
      setLocAddress('');
      setLocDesc('');
      setNotice(`Storage location "${data.location.name}" created.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Creation failed.');
    } finally {
      setBusy(null);
    }
  }

  const availableEntries = entries.filter((e) => Number(e.availableWeightKg) > 0 && e.status !== 'BATCHED');
  const dispatchableBatches = batches.filter(
    (b) => Number(b.availableWeightKg) > 0 && b.status !== 'CONSOLIDATED' && b.status !== 'SOLD'
  );

  return (
    <div className="space-y-6">
      {/* Inventory KPI Strip */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 border border-[#DAD7CE] bg-white divide-y sm:divide-y-0 sm:divide-x divide-[#E5E2D9] rounded-sm">
          <div className="p-4">
            <p className="text-xs text-[#59605B]">Unbatched Verified Stock</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
              {summary.totalUnbatchedKg} kg
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-[#59605B]">Batched Available Stock</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-[#17372D] tabular-nums">
              {summary.totalBatchedAvailableKg} kg
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-[#59605B]">Active Material Batches</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
              {summary.activeBatchCount}
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-[#59605B]">Sold / Transferred Out</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-[#8A4E11] tabular-nums">
              {summary.totalSoldKg} kg
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['stock', `Verified Stock (${entries.length})`],
              ['batches', `Material Batches (${batches.length})`],
              ['transfers', `Transfers (${transfers.length})`],
              ['sales', `Buyer Sales (${sales.length})`],
              ['locations', `Storage Locations (${locations.length})`],
              ['movements', 'Movement Log'],
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

      {loading && <p className="text-sm text-[#59605B]">Loading inventory records...</p>}

      {/* STOCK ENTRIES + BATCH FORMATION */}
      {!loading && subTab === 'stock' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateBatch}
            className="bg-[#EFECE4] border border-[#DAD7CE] rounded-sm p-4 flex flex-col lg:flex-row lg:items-end gap-3"
          >
            <div className="flex-1">
              <p className="text-xs font-semibold text-[#171B19]">
                Create Material Batch from Selected Entries ({selectedEntryIds.length} selected)
              </p>
              <p className="text-xs text-[#59605B]">
                Select verified stock rows of the same material below to group into a traceable batch.
              </p>
            </div>
            <select
              value={batchLocationId}
              onChange={(e) => setBatchLocationId(e.target.value)}
              className="min-h-[40px] px-3 text-xs bg-white border border-[#C9C5BA] rounded-sm"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={batchNotes}
              onChange={(e) => setBatchNotes(e.target.value)}
              placeholder="Optional batch notes"
              className="min-h-[40px] px-3 text-xs bg-white border border-[#C9C5BA] rounded-sm"
            />
            <button
              type="submit"
              disabled={busy === 'create-batch' || selectedEntryIds.length === 0}
              className="min-h-[40px] px-4 text-xs font-semibold bg-[#17372D] text-[#F7F6F2] disabled:opacity-50 rounded-sm cursor-pointer shrink-0"
            >
              {busy === 'create-batch' ? 'Creating...' : 'Create Batch'}
            </button>
          </form>

          <div className="bg-white border border-[#DAD7CE] rounded-sm overflow-x-auto">
            {entries.length === 0 ? (
              <p className="p-6 text-sm text-[#59605B]">
                No verified inventory entries yet. Approve a collection weight verification to
                automatically receive material into inventory.
              </p>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F6F2] border-b border-[#DAD7CE] text-[#59605B] uppercase">
                    <th className="py-2.5 px-3">Pick</th>
                    <th className="py-2.5 px-3">Inventory Ref</th>
                    <th className="py-2.5 px-3">Source Collection</th>
                    <th className="py-2.5 px-3">Material</th>
                    <th className="py-2.5 px-3">Location</th>
                    <th className="py-2.5 px-3 text-right">Available / Initial</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E2D9]">
                  {entries.map((e) => {
                    const selectable = availableEntries.some((x) => x.id === e.id);
                    return (
                      <tr key={e.id}>
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            disabled={!selectable}
                            checked={selectedEntryIds.includes(e.id)}
                            onChange={() =>
                              setSelectedEntryIds((prev) =>
                                prev.includes(e.id) ? prev.filter((x) => x !== e.id) : [...prev, e.id]
                              )
                            }
                            className="h-4 w-4 accent-[#17372D]"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono font-semibold text-[#171B19]">
                          {e.referenceCode}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[#3F4541]">
                          {e.collectionReference}
                        </td>
                        <td className="py-2.5 px-3 font-medium">{e.materialName}</td>
                        <td className="py-2.5 px-3 text-[#59605B]">{e.storageLocationName}</td>
                        <td className="py-2.5 px-3 font-mono text-right tabular-nums">
                          {e.availableWeightKg} / {e.initialWeightKg} kg
                        </td>
                        <td className="py-2.5 px-3 font-semibold">{e.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* BATCHES + CONSOLIDATION + TRACEABILITY */}
      {!loading && subTab === 'batches' && (
        <div className="space-y-4">
          <div className="bg-[#EFECE4] border border-[#DAD7CE] rounded-sm p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[#3F4541]">
              Select 2 or more open batches of the <strong>same material</strong> to consolidate
              while preserving 100% source collection traceability ({selectedBatchIds.length}{' '}
              selected).
            </p>
            <button
              type="button"
              disabled={busy === 'consolidate' || selectedBatchIds.length < 2}
              onClick={handleConsolidateBatches}
              className="min-h-[40px] px-4 text-xs font-semibold bg-[#17372D] text-[#F7F6F2] disabled:opacity-50 rounded-sm cursor-pointer"
            >
              {busy === 'consolidate' ? 'Consolidating...' : 'Consolidate Selected Batches'}
            </button>
          </div>

          {batches.length === 0 ? (
            <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 text-sm text-[#59605B]">
              No material batches created yet. Select verified stock entries to form your first batch.
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map((b) => {
                const canConsolidate =
                  Number(b.availableWeightKg) > 0 && b.status !== 'CONSOLIDATED' && b.status !== 'SOLD';
                const expanded = expandedBatchId === b.id;
                return (
                  <div key={b.id} className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          disabled={!canConsolidate}
                          checked={selectedBatchIds.includes(b.id)}
                          onChange={() =>
                            setSelectedBatchIds((prev) =>
                              prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id]
                            )
                          }
                          className="mt-1 h-4 w-4 accent-[#17372D]"
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="font-mono font-semibold text-[#171B19]">
                              {b.batchReference}
                            </span>
                            <span className="font-semibold text-[#17372D]">{b.materialName}</span>
                            <span className="font-mono text-xs text-[#8A4E11]">{b.status}</span>
                          </div>
                          <p className="text-xs text-[#59605B] mt-1">
                            Available: <strong className="font-mono">{b.availableWeightKg} kg</strong>{' '}
                            / Total: <span className="font-mono">{b.totalWeightKg} kg</span> ·
                            Location: {b.storageLocationName} · {b.sourceTraceability.length} source
                            collection(s)
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpandedBatchId(expanded ? null : b.id)}
                        className="min-h-[36px] px-3 text-xs font-medium border border-[#C9C5BA] bg-[#F7F6F2] rounded-sm cursor-pointer"
                      >
                        {expanded ? 'Hide Traceability' : 'Trace Origin'}
                      </button>
                    </div>

                    {expanded && (
                      <div className="mt-4 pt-3 border-t border-[#E5E2D9] space-y-1.5 text-xs">
                        <p className="font-semibold text-[#171B19]">
                          Verified Origin Traceability Chain:
                        </p>
                        {b.sourceTraceability.map((src, i) => (
                          <div
                            key={`${src.inventoryEntryId}-${i}`}
                            className="flex flex-wrap justify-between gap-2 text-[#3F4541] bg-[#F7F6F2] px-3 py-2 rounded-sm"
                          >
                            <span className="font-mono">
                              {src.collectionReference} → {src.inventoryReference} (Verification #
                              {src.verificationId})
                            </span>
                            <span>
                              Agent: {src.agentName} ·{' '}
                              <strong className="font-mono">{src.allocatedWeightKg} kg</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TRANSFERS */}
      {!loading && subTab === 'transfers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateTransfer}
            className="lg:col-span-4 bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-4 self-start"
          >
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Initiate Location Transfer
            </h3>
            <div>
              <label className="block text-xs font-medium">Material batch</label>
              <select
                required
                value={trBatchId}
                onChange={(e) => setTrBatchId(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              >
                <option value="">Select batch...</option>
                {dispatchableBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchReference} · {b.materialName} ({b.availableWeightKg} kg)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Destination storage location</label>
              <select
                required
                value={trDestLocId}
                onChange={(e) => setTrDestLocId(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Responsible handler / transporter</label>
              <input
                type="text"
                required
                value={trParty}
                onChange={(e) => setTrParty(e.target.value)}
                placeholder="e.g. KILN Pilot Dispatch Van 1"
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">Notes (optional)</label>
              <input
                type="text"
                value={trNotes}
                onChange={(e) => setTrNotes(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy === 'create-transfer' || !trBatchId}
              className="w-full min-h-[42px] text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
            >
              Create Transfer
            </button>
          </form>

          <div className="lg:col-span-8 bg-white border border-[#DAD7CE] rounded-sm divide-y divide-[#E5E2D9]">
            <div className="p-4">
              <h3 className="font-display text-lg font-semibold text-[#171B19]">
                Transfer Records ({transfers.length})
              </h3>
            </div>
            {transfers.length === 0 ? (
              <p className="p-5 text-sm text-[#59605B]">No inter-location transfers recorded yet.</p>
            ) : (
              transfers.map((t) => (
                <div key={t.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-mono font-semibold text-[#171B19]">
                      {t.transferReference} · {t.batchReference} ({t.quantityKg} kg {t.materialName})
                    </p>
                    <p className="text-[#59605B] mt-0.5">
                      {t.sourceLocationName} → {t.destinationLocationName} · Handler:{' '}
                      {t.responsibleParty} · Status: <strong>{t.status}</strong>
                    </p>
                  </div>
                  {(t.status === 'PENDING' || t.status === 'IN_TRANSIT') && (
                    <div className="flex gap-2">
                      {t.status === 'PENDING' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateTransferStatus(t.id, 'IN_TRANSIT')}
                          className="min-h-[34px] px-3 text-xs font-medium border border-[#C9C5BA] rounded-sm cursor-pointer"
                        >
                          Mark In Transit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleUpdateTransferStatus(t.id, 'CONFIRMED')}
                        className="min-h-[34px] px-3 text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
                      >
                        Confirm Receipt
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* BUYER SALES */}
      {!loading && subTab === 'sales' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateSale}
            className="lg:col-span-4 bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-3.5 self-start"
          >
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Record Material Sale / Buyer Transfer
            </h3>
            <div>
              <label className="block text-xs font-medium">Source batch</label>
              <select
                required
                value={saleBatchId}
                onChange={(e) => setSaleBatchId(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              >
                <option value="">Select batch...</option>
                {dispatchableBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchReference} · {b.materialName} ({b.availableWeightKg} kg avail)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Buyer / Recycler name</label>
              <input
                type="text"
                required
                value={saleBuyer}
                onChange={(e) => setSaleBuyer(e.target.value)}
                placeholder="e.g. Imo PET Recycling Offtaker (Demo)"
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium">Quantity (kg)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={saleQty}
                  onChange={(e) => setSaleQty(e.target.value)}
                  className="mt-1 w-full min-h-[40px] px-3 text-xs font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium">Unit price (NGN/kg)</label>
                <input
                  type="number"
                  step="0.01"
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  className="mt-1 w-full min-h-[40px] px-3 text-xs font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium">Waybill / Invoice Ref (optional)</label>
              <input
                type="text"
                value={saleDocRef}
                onChange={(e) => setSaleDocRef(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium">Buyer contact (optional)</label>
              <input
                type="text"
                value={saleContact}
                onChange={(e) => setSaleContact(e.target.value)}
                className="mt-1 w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy === 'create-sale' || !saleBatchId}
              className="w-full min-h-[42px] text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
            >
              Record Sale (Oversell-Protected)
            </button>
          </form>

          <div className="lg:col-span-8 bg-white border border-[#DAD7CE] rounded-sm divide-y divide-[#E5E2D9]">
            <div className="p-4">
              <h3 className="font-display text-lg font-semibold text-[#171B19]">
                Sales &amp; Buyer Transfers ({sales.length})
              </h3>
            </div>
            {sales.length === 0 ? (
              <p className="p-5 text-sm text-[#59605B]">No material sales recorded yet.</p>
            ) : (
              sales.map((s) => (
                <div key={s.id} className="p-4 space-y-2 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-mono font-semibold text-[#171B19]">
                      {s.saleReference} · {s.batchReference} · {s.quantityKg} kg {s.materialName}
                    </span>
                    <span className="font-mono text-[#17372D] font-semibold">
                      {s.totalValueNgn ? `₦${s.totalValueNgn}` : 'Price TBD'}
                    </span>
                  </div>
                  <p className="text-[#59605B]">
                    Buyer: <strong>{s.buyerName}</strong> · Transfer:{' '}
                    <strong>{s.transferStatus}</strong> · Payment:{' '}
                    <strong>{s.paymentStatus}</strong>
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {s.transferStatus !== 'DELIVERED' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateSale(s, { transferStatus: 'DELIVERED' })}
                        className="min-h-[32px] px-2.5 text-xs border border-[#C9C5BA] rounded-sm cursor-pointer"
                      >
                        Mark Delivered
                      </button>
                    )}
                    {s.paymentStatus !== 'PAID' && (
                      <button
                        type="button"
                        onClick={() => handleUpdateSale(s, { paymentStatus: 'PAID' })}
                        className="min-h-[32px] px-2.5 text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
                      >
                        Mark Payment Received
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* STORAGE LOCATIONS */}
      {!loading && subTab === 'locations' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateLocation}
            className="lg:col-span-4 bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-3.5 self-start"
          >
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Add Storage Location
            </h3>
            <input
              type="text"
              required
              value={locName}
              onChange={(e) => setLocName(e.target.value)}
              placeholder="Location name (include DEMO if pilot)"
              className="w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <input
              type="text"
              required
              value={locAddress}
              onChange={(e) => setLocAddress(e.target.value)}
              placeholder="Address / campus reference"
              className="w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <select
              value={locArea}
              onChange={(e) => setLocArea(e.target.value)}
              className="w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            >
              {PILOT_COMMUNITY_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <textarea
              rows={2}
              required
              value={locDesc}
              onChange={(e) => setLocDesc(e.target.value)}
              placeholder="Description and sorting capacity notes"
              className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={locIsDemo}
                onChange={(e) => setLocIsDemo(e.target.checked)}
                className="h-4 w-4 accent-[#17372D]"
              />
              <span>Label as DEMO storage facility</span>
            </label>
            <button
              type="submit"
              disabled={busy === 'create-loc'}
              className="w-full min-h-[42px] text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
            >
              Add Location
            </button>
          </form>

          <div className="lg:col-span-8 bg-white border border-[#DAD7CE] rounded-sm divide-y divide-[#E5E2D9]">
            {locations.map((loc) => (
              <div key={loc.id} className="p-4 flex flex-wrap justify-between gap-3 text-xs">
                <div>
                  <p className="font-semibold text-sm text-[#171B19]">
                    {loc.name}{' '}
                    {loc.isDemo && (
                      <span className="font-mono text-xs text-[#8A4E11]">[DEMO]</span>
                    )}
                  </p>
                  <p className="text-[#59605B]">
                    {loc.address} · {loc.communityArea}
                  </p>
                  <p className="text-[#59605B] mt-0.5">{loc.description}</p>
                </div>
                <div className="text-right font-mono">
                  <p className="font-semibold text-[#17372D]">{loc.totalAvailableKg} kg</p>
                  <p className="text-[#59605B]">{loc.activeBatchCount} batch(es)</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MOVEMENTS LOG */}
      {!loading && subTab === 'movements' && (
        <div className="bg-white border border-[#DAD7CE] rounded-sm overflow-x-auto">
          {movements.length === 0 ? (
            <p className="p-6 text-sm text-[#59605B]">No inventory movements recorded yet.</p>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F7F6F2] border-b border-[#DAD7CE] text-[#59605B] uppercase">
                  <th className="py-2.5 px-3">Ref</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Material / Batch</th>
                  <th className="py-2.5 px-3 text-right">Delta (kg)</th>
                  <th className="py-2.5 px-3">Reason</th>
                  <th className="py-2.5 px-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E2D9]">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 px-3 font-mono">{m.referenceCode}</td>
                    <td className="py-2.5 px-3 font-semibold">{m.movementType}</td>
                    <td className="py-2.5 px-3">
                      {m.materialName}
                      {m.batchReference ? ` (${m.batchReference})` : ''}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-right tabular-nums">
                      {m.quantityDeltaKg}
                    </td>
                    <td className="py-2.5 px-3 text-[#59605B]">{m.reason}</td>
                    <td className="py-2.5 px-3 font-mono text-[#59605B] whitespace-nowrap">
                      {formatDateTime(m.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Keep reference to materials prop used cleanly */}
      {materials.length === 0 && null}
    </div>
  );
}
