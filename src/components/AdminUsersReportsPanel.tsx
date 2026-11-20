import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { MaterialCategory, UserRole } from '../types/kiln';
import { formatDateTime } from '../lib/status-labels';

interface AdminUserRow {
  id: number;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  role: UserRole;
  isActive: boolean;
  isDemo: boolean;
  communityArea: string;
  availablePoints: string;
  totalEarnedPoints: string;
  createdAt: string;
}

interface AuditLogRow {
  id: number;
  action: string;
  targetType: string;
  targetId: string | null;
  details: string | null;
  actorName: string;
  actorRole: string | null;
  createdAt: string;
}

export function AdminUsersReportsPanel({
  onMaterialsChanged,
}: {
  onMaterialsChanged?: () => void;
}) {
  const { user: currentUser, authFetch } = useAuth();
  const [subTab, setSubTab] = useState<'users' | 'materials' | 'reports' | 'audit'>('reports');

  // Users
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('ALL');

  // Materials
  const [materials, setMaterials] = useState<MaterialCategory[]>([]);
  const [matName, setMatName] = useState('');
  const [matDesc, setMatDesc] = useState('');
  const [matAccept, setMatAccept] = useState('');
  const [matPrep, setMatPrep] = useState('');
  const [matContam, setMatContam] = useState('');

  // Reports
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reports, setReports] = useState<{
    collections: { totalRequests: number; verifiedCount: number; verifiedWeightKg: string };
    rewards: { totalCreditedPoints: string; totalRedeemedPoints: string; paidRedemptions: number };
    inventory: { unbatchedKg: string; batchedAvailableKg: string; soldKg: string; salesRevenueNgn: string };
    learning: { totalCompletions: number; passedCompletions: number };
    materialsBreakdown?: Array<{
      materialCategoryId: number;
      materialName: string;
      requestsCount: number;
      verifiedEligibleKg: string;
      pointsAwarded: string;
    }>;
  } | null>(null);

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditSearch, setAuditSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const uQs = new URLSearchParams();
      if (userSearch.trim()) uQs.set('search', userSearch.trim());
      if (userRoleFilter !== 'ALL') uQs.set('role', userRoleFilter);

      const rQs = new URLSearchParams();
      if (dateFrom) rQs.set('dateFrom', dateFrom);
      if (dateTo) rQs.set('dateTo', dateTo);

      const aQs = new URLSearchParams({ limit: '100' });
      if (auditSearch.trim()) aQs.set('search', auditSearch.trim());

      const [uRes, mRes, rRes, aRes] = await Promise.all([
        authFetch(`/api/admin/users?${uQs.toString()}`),
        authFetch('/api/admin/materials'),
        authFetch(`/api/admin/reports?${rQs.toString()}`),
        authFetch(`/api/admin/audit-logs?${aQs.toString()}`),
      ]);
      const [uD, mD, rD, aD] = await Promise.all([
        uRes.ok ? uRes.json() : Promise.resolve({ users: [] }),
        mRes.ok ? mRes.json() : Promise.resolve({ materials: [] }),
        rRes.ok ? rRes.json() : Promise.resolve({ reports: null }),
        aRes.ok ? aRes.json() : Promise.resolve({ logs: [] }),
      ]);
      setUsersList(Array.isArray(uD.users) ? uD.users : []);
      setMaterials(Array.isArray(mD.materials) ? mD.materials : []);
      setReports(rD.reports ?? null);
      setAuditLogs(Array.isArray(aD.logs) ? aD.logs : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load admin governance data.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, userSearch, userRoleFilter, dateFrom, dateTo, auditSearch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleUpdateUser(target: AdminUserRow, patch: { role?: UserRole; isActive?: boolean }) {
    setBusy(`usr-${target.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not update user.');
      setNotice(`Updated account for ${target.fullName}.`);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateMaterial(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create-mat');
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch('/api/admin/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: matName,
          description: matDesc,
          acceptanceInfo: matAccept,
          preparationRequirements: matPrep,
          contaminationRules: matContam,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create material category.');
      setMatName('');
      setMatDesc('');
      setMatAccept('');
      setMatPrep('');
      setMatContam('');
      setNotice(`Material category "${data.material.name}" created.`);
      await loadData();
      onMaterialsChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Material creation failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleMaterial(mat: MaterialCategory) {
    setBusy(`mat-${mat.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(`/api/admin/materials/${mat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !mat.isActive }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not update material.');
      }
      setNotice(`Material "${mat.name}" updated.`);
      await loadData();
      onMaterialsChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDownloadCsv(type: string) {
    setBusy(`csv-${type}`);
    setError(null);
    try {
      const qs = new URLSearchParams({ type });
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      const res = await authFetch(`/api/admin/reports/export?${qs.toString()}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Export failed.');
      }
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kiln-${type}-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice(`Exported ${type} CSV report (formula-injection protected).`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'CSV export error.');
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
              ['reports', 'Operational Reports & CSV Exports'],
              ['users', `Users & Roles (${usersList.length})`],
              ['materials', `Material Categories (${materials.length})`],
              ['audit', `Audit Logs (${auditLogs.length})`],
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

      {loading && <p className="text-sm text-[#59605B]">Loading governance records...</p>}

      {/* REPORTS & CSV EXPORTS */}
      {!loading && subTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-[#59605B]">From date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[#59605B]">To date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="min-h-[40px] px-3 text-xs border border-[#C9C5BA] rounded-sm cursor-pointer"
              >
                Clear Dates
              </button>
            )}
          </div>

          {reports && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                <p className="text-xs text-[#59605B]">Collections (Filtered)</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {reports.collections.totalRequests}
                </p>
                <p className="text-xs text-[#59605B] mt-1 font-mono">
                  Verified: {reports.collections.verifiedCount} ({reports.collections.verifiedWeightKg} kg)
                </p>
              </div>
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                <p className="text-xs text-[#59605B]">Rewards &amp; Payouts</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-[#17372D] tabular-nums">
                  {reports.rewards.totalCreditedPoints} pts
                </p>
                <p className="text-xs text-[#59605B] mt-1 font-mono">
                  Paid Out: {reports.rewards.totalRedeemedPoints} pts ({reports.rewards.paidRedemptions})
                </p>
              </div>
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                <p className="text-xs text-[#59605B]">Inventory &amp; Sales</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {reports.inventory.batchedAvailableKg} kg
                </p>
                <p className="text-xs text-[#59605B] mt-1 font-mono">
                  Sold: {reports.inventory.soldKg} kg · ₦{reports.inventory.salesRevenueNgn}
                </p>
              </div>
              <div className="bg-white border border-[#DAD7CE] rounded-sm p-5">
                <p className="text-xs text-[#59605B]">Learn &amp; Earn Activity</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-[#171B19] tabular-nums">
                  {reports.learning.passedCompletions}
                </p>
                <p className="text-xs text-[#59605B] mt-1 font-mono">
                  Passed / {reports.learning.totalCompletions} records
                </p>
              </div>
            </div>
          )}

          {reports?.materialsBreakdown && reports.materialsBreakdown.length > 0 && (
            <div className="bg-white border border-[#DAD7CE] rounded-sm overflow-x-auto">
              <div className="px-5 py-3.5 border-b border-[#E5E2D9]">
                <h3 className="font-display text-base font-semibold text-[#171B19]">
                  Verified Material Breakdown
                </h3>
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F6F2] border-b border-[#DAD7CE] text-[#59605B] uppercase">
                    <th className="py-2.5 px-4">Material Category</th>
                    <th className="py-2.5 px-4 text-right">Requests</th>
                    <th className="py-2.5 px-4 text-right">Verified Eligible (kg)</th>
                    <th className="py-2.5 px-4 text-right">Points Awarded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E2D9]">
                  {reports.materialsBreakdown.map((m) => (
                    <tr key={m.materialCategoryId}>
                      <td className="py-2.5 px-4 font-semibold text-[#171B19]">{m.materialName}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.requestsCount}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.verifiedEligibleKg}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#17372D] font-semibold">
                        {m.pointsAwarded} pts
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white border border-[#DAD7CE] rounded-sm p-6">
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Download Audited CSV Exports
            </h3>
            <p className="mt-1 text-xs text-[#59605B]">
              All CSV exports neutralize spreadsheet formula prefixes, mask payout destinations, and
              exclude secrets. Every download is logged to the audit trail.
            </p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {(
                [
                  ['collections', 'Collections'],
                  ['verifications', 'Verifications'],
                  ['rewards', 'Reward Ledger'],
                  ['redemptions', 'Redemptions'],
                  ['inventory', 'Inventory'],
                  ['sales', 'Material Sales'],
                  ['audit', 'Audit Logs'],
                ] as const
              ).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  disabled={busy === `csv-${type}`}
                  onClick={() => handleDownloadCsv(type)}
                  className="min-h-[44px] px-3 py-2 text-xs font-semibold text-[#17372D] border border-[#17372D] bg-[#F7F6F2] hover:bg-[#EEF4F0] rounded-sm inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* USERS & ROLES */}
      {!loading && subTab === 'users' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search user name or email..."
              className="min-h-[40px] px-3 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <select
              value={userRoleFilter}
              onChange={(e) => setUserRoleFilter(e.target.value)}
              className="min-h-[40px] px-3 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            >
              <option value="ALL">All Roles</option>
              <option value="USER">USER (Participant)</option>
              <option value="AGENT">AGENT (Collection Agent)</option>
              <option value="ADMIN">ADMIN (Administrator)</option>
            </select>
          </div>

          <div className="bg-white border border-[#DAD7CE] rounded-sm overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F7F6F2] border-b border-[#DAD7CE] text-[#59605B] uppercase">
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">Area</th>
                  <th className="py-2.5 px-3 text-right">Wallet (Avail)</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E2D9]">
                {usersList.map((u) => {
                  const isSelf = currentUser?.id === u.id;
                  return (
                    <tr key={u.id}>
                      <td className="py-2.5 px-3">
                        <p className="font-semibold text-[#171B19]">
                          {u.fullName} {u.isDemo ? '[DEMO]' : ''}
                        </p>
                        <p className="text-[#59605B]">{u.email}</p>
                      </td>
                      <td className="py-2.5 px-3 text-[#59605B]">{u.communityArea}</td>
                      <td className="py-2.5 px-3 font-mono text-right tabular-nums">
                        {u.availablePoints} pts
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          disabled={isSelf || busy === `usr-${u.id}`}
                          value={u.role}
                          onChange={(e) =>
                            handleUpdateUser(u, { role: e.target.value as UserRole })
                          }
                          className="min-h-[34px] px-2 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm disabled:opacity-60"
                        >
                          <option value="USER">USER</option>
                          <option value="AGENT">AGENT</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          disabled={isSelf || busy === `usr-${u.id}`}
                          onClick={() => handleUpdateUser(u, { isActive: !u.isActive })}
                          className={`min-h-[34px] px-3 text-xs font-semibold rounded-sm disabled:opacity-50 cursor-pointer ${
                            u.isActive
                              ? 'text-[#14532D] border border-[#B7CEC0] bg-[#EEF4F0]'
                              : 'text-[#991B1B] border border-[#E6B8B0] bg-[#FDF2F0]'
                          }`}
                        >
                          {u.isActive ? 'Active' : 'Suspended'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MATERIAL CATEGORIES CRUD */}
      {!loading && subTab === 'materials' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateMaterial}
            className="lg:col-span-5 bg-white border border-[#DAD7CE] rounded-sm p-5 space-y-3 self-start"
          >
            <h3 className="font-display text-lg font-semibold text-[#171B19]">
              Add Material Category
            </h3>
            <input
              type="text"
              required
              value={matName}
              onChange={(e) => setMatName(e.target.value)}
              placeholder="Category name (e.g. HDPE Containers)"
              className="w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <textarea
              rows={2}
              required
              value={matDesc}
              onChange={(e) => setMatDesc(e.target.value)}
              placeholder="Plain-language description"
              className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <input
              type="text"
              required
              value={matAccept}
              onChange={(e) => setMatAccept(e.target.value)}
              placeholder="What is accepted"
              className="w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <input
              type="text"
              required
              value={matPrep}
              onChange={(e) => setMatPrep(e.target.value)}
              placeholder="Preparation requirements (e.g. Rinse & dry)"
              className="w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <input
              type="text"
              required
              value={matContam}
              onChange={(e) => setMatContam(e.target.value)}
              placeholder="Contamination rules (what will be rejected)"
              className="w-full min-h-[40px] px-3 text-xs bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm"
            />
            <button
              type="submit"
              disabled={busy === 'create-mat'}
              className="w-full min-h-[42px] text-xs font-semibold bg-[#17372D] text-[#F7F6F2] rounded-sm cursor-pointer"
            >
              Add Category
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-[#DAD7CE] rounded-sm divide-y divide-[#E5E2D9]">
            {materials.map((m) => (
              <div key={m.id} className="p-4 flex flex-wrap justify-between gap-3 text-xs">
                <div className="max-w-lg">
                  <p className="font-semibold text-sm text-[#171B19]">
                    {m.name} ({m.unit})
                  </p>
                  <p className="text-[#59605B] mt-0.5">{m.description}</p>
                  <p className="text-[#59605B] mt-0.5">
                    <strong>Prep:</strong> {m.preparationRequirements}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === `mat-${m.id}`}
                  onClick={() => handleToggleMaterial(m)}
                  className="min-h-[34px] px-3 text-xs font-semibold border border-[#C9C5BA] bg-[#F7F6F2] rounded-sm self-start cursor-pointer"
                >
                  {m.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* READ-ONLY AUDIT LOGS */}
      {!loading && subTab === 'audit' && (
        <div className="space-y-4">
          <input
            type="text"
            value={auditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            placeholder="Filter audit trail by action, actor, or details..."
            className="w-full sm:max-w-md min-h-[40px] px-3 text-sm bg-white border border-[#C9C5BA] rounded-sm"
          />
          <div className="bg-white border border-[#DAD7CE] rounded-sm overflow-x-auto">
            {auditLogs.length === 0 ? (
              <p className="p-6 text-sm text-[#59605B]">No audit log entries match your filter.</p>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F7F6F2] border-b border-[#DAD7CE] text-[#59605B] uppercase">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Actor</th>
                    <th className="py-2.5 px-3">Target</th>
                    <th className="py-2.5 px-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E2D9]">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2.5 px-3 font-mono text-[#59605B] whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-[#171B19]">
                        {log.action}
                      </td>
                      <td className="py-2.5 px-3">
                        {log.actorName} {log.actorRole ? `(${log.actorRole})` : ''}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[#59605B]">
                        {log.targetType}
                        {log.targetId ? ` #${log.targetId}` : ''}
                      </td>
                      <td className="py-2.5 px-3 text-[#3F4541]">{log.details ?? '—'}</td>
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
