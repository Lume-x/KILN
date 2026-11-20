import React, { useEffect, useState } from 'react';
import { LogOut, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PILOT_COMMUNITY_AREAS, type AppRoute } from '../types/kiln';

interface AccountPageProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
}

const ROLE_LABELS: Record<string, string> = {
  USER: 'Participant (Regular User)',
  AGENT: 'Collection Agent',
  ADMIN: 'Administrator',
};

export function AccountPage({ onNavigate }: AccountPageProps) {
  const { user, loading, logout, updateProfile } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [communityArea, setCommunityArea] = useState<string>(PILOT_COMMUNITY_AREAS[0]);
  const [address, setAddress] = useState('');
  const [lightningAddress, setLightningAddress] = useState('');

  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      onNavigate('/login');
    }
  }, [loading, user, onNavigate]);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setPhoneNumber(user.phoneNumber ?? '');
      setCommunityArea(user.communityArea || PILOT_COMMUNITY_AREAS[0]);
      setAddress(user.address ?? '');
      setLightningAddress(user.lightningAddress ?? '');
    }
  }, [user]);

  if (loading || !user) {
    return (
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <p className="text-sm text-[#59605B]">Loading your KILN account...</p>
      </main>
    );
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      await updateProfile({
        fullName,
        phoneNumber,
        communityArea,
        address,
        lightningAddress,
      });
      setSaveSuccess(true);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save profile.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      onNavigate('/');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-8 border-b border-[#DAD7CE]">
        <div>
          <p className="text-xs font-medium text-[#59605B]">
            KILN Account · {ROLE_LABELS[user.role] || user.role}
          </p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
            Welcome, {user.fullName}
          </h1>
          <p className="mt-1.5 text-sm text-[#59605B]">
            {user.email} · {user.communityArea}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#171B19] border border-[#C9C5BA] bg-white hover:bg-[#EFECE4] rounded-sm inline-flex items-center gap-2 self-start sm:self-auto cursor-pointer"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          <span>{signingOut ? 'Signing out...' : 'Sign Out'}</span>
        </button>
      </div>

      <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Account & Wallet Foundation Summary */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white border border-[#DAD7CE] rounded-sm p-6">
            <h2 className="font-display text-xl font-semibold text-[#171B19]">
              Verified Reward Wallet
            </h2>
            <p className="mt-1.5 text-sm text-[#59605B]">
              Points are credited automatically when your physical weight is verified or when you
              pass a Learn &amp; Earn module quiz.
            </p>

            <dl className="mt-5 pt-5 border-t border-[#E6E3DA] grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-[#59605B]">Available points</dt>
                <dd className="mt-1 font-mono text-xl font-semibold text-[#17372D] tabular-nums">
                  {user.wallet.availablePoints}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#59605B]">Total earned</dt>
                <dd className="mt-1 font-mono text-xl font-semibold text-[#171B19] tabular-nums">
                  {user.wallet.totalEarnedPoints}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#59605B]">Pending redemptions</dt>
                <dd className="mt-1 font-mono text-base font-medium text-[#8A4E11] tabular-nums">
                  {user.wallet.pendingRedemptionPoints}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[#59605B]">Total redeemed</dt>
                <dd className="mt-1 font-mono text-base font-medium text-[#3F4541] tabular-nums">
                  {user.wallet.totalRedeemedPoints}
                </dd>
              </div>
            </dl>
          </section>

          <section className="bg-[#EFECE4] border border-[#DAD7CE] rounded-sm p-6">
            <h2 className="font-display text-xl font-semibold text-[#171B19]">
              KILN Workspaces
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#3F4541]">
              Schedule recyclable pickups or drop-offs, track verified rewards and redemptions, use
              the AI Waste Sorter, and complete Learn &amp; Earn modules.
            </p>
            <div className="mt-4 pt-4 border-t border-[#DAD7CE] text-xs text-[#59605B] space-y-1.5">
              <p>
                Assigned role: <strong className="text-[#171B19]">{user.role}</strong> (enforced
                server-side)
              </p>
              <p>
                Pilot area: <strong className="text-[#171B19]">{user.communityArea}</strong>
              </p>
            </div>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => onNavigate('/collections')}
                className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer text-left"
              >
                Collection Requests &amp; History
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/wallet')}
                className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-[#17372D] border border-[#17372D] bg-white hover:bg-[#F7F6F2] rounded-sm cursor-pointer text-left"
              >
                Reward Wallet, Redemptions &amp; Notifications
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/learn')}
                className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-[#17372D] border border-[#17372D] bg-white hover:bg-[#F7F6F2] rounded-sm cursor-pointer text-left"
              >
                AI Waste Sorter &amp; Learn and Earn
              </button>
              {user.role === 'AGENT' && (
                <button
                  type="button"
                  onClick={() => onNavigate('/agent')}
                  className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-[#17372D] border border-[#17372D] bg-white hover:bg-[#F7F6F2] rounded-sm cursor-pointer text-left"
                >
                  Open Agent Assignment Desk
                </button>
              )}
              {user.role === 'ADMIN' && (
                <button
                  type="button"
                  onClick={() => onNavigate('/admin')}
                  className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-[#17372D] border border-[#17372D] bg-white hover:bg-[#F7F6F2] rounded-sm cursor-pointer text-left"
                >
                  Open Admin Operations Console
                </button>
              )}
            </div>
          </section>
        </div>

        {/* Editable Profile Form */}
        <div className="lg:col-span-7">
          <section className="bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold text-[#171B19]">
              Participant Profile
            </h2>
            <p className="mt-1 text-sm text-[#59605B]">
              Keep your contact details and community area current for upcoming FUTO &amp; Owerri
              collections.
            </p>

            {saveError && (
              <div
                role="alert"
                className="mt-5 p-3.5 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm"
              >
                {saveError}
              </div>
            )}

            {saveSuccess && (
              <div
                role="status"
                className="mt-5 p-3.5 text-sm text-[#17372D] bg-[#EEF4F0] border border-[#B7CEC0] rounded-sm flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Profile details saved.</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="mt-6 space-y-4">
              <div>
                <label htmlFor="prof-fullname" className="block text-sm font-medium text-[#171B19]">
                  Full name
                </label>
                <input
                  id="prof-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="prof-email" className="block text-sm font-medium text-[#171B19]">
                    Email address
                  </label>
                  <input
                    id="prof-email"
                    type="email"
                    disabled
                    value={user.email}
                    className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#EFECE4] border border-[#DAD7CE] rounded-sm text-[#59605B] cursor-not-allowed"
                  />
                </div>

                <div>
                  <label htmlFor="prof-phone" className="block text-sm font-medium text-[#171B19]">
                    Phone number
                  </label>
                  <input
                    id="prof-phone"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+234 ..."
                    className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="prof-community" className="block text-sm font-medium text-[#171B19]">
                  Community area
                </label>
                <select
                  id="prof-community"
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
                <label htmlFor="prof-address" className="block text-sm font-medium text-[#171B19]">
                  Hostel, lodge, or street landmark{' '}
                  <span className="text-[#59605B] font-normal">(optional)</span>
                </label>
                <input
                  id="prof-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Near FUTO Main Gate, Ihiagwa"
                  className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                />
              </div>

              <div>
                <label htmlFor="prof-ln" className="block text-sm font-medium text-[#171B19]">
                  Bitcoin Lightning address{' '}
                  <span className="text-[#59605B] font-normal">(optional)</span>
                </label>
                <input
                  id="prof-ln"
                  type="text"
                  value={lightningAddress}
                  onChange={(e) => setLightningAddress(e.target.value)}
                  placeholder="e.g. ada@getalby.com"
                  className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-6 py-2.5 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm transition-colors cursor-pointer"
              >
                {saving ? 'Saving changes...' : 'Save Profile'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
