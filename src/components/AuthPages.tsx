import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { PILOT_COMMUNITY_AREAS, type AppRoute } from '../types/kiln';
import type { LegalDocType } from './LegalModal';

interface AuthPageProps {
  onNavigate: (route: AppRoute, hash?: string) => void;
  onOpenLegal: (doc: LegalDocType) => void;
}

export function RegisterPage({ onNavigate, onOpenLegal }: AuthPageProps) {
  const { registerWithEmail, loginWithGoogle } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [communityArea, setCommunityArea] = useState<string>(PILOT_COMMUNITY_AREAS[0]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please check and try again.');
      return;
    }

    if (!termsAccepted) {
      setError('Please accept the KILN pilot terms of participation to continue.');
      return;
    }

    setSubmitting(true);
    try {
      await registerWithEmail({
        fullName,
        email,
        phoneNumber,
        password,
        communityArea,
        termsAccepted,
      });
      onNavigate('/account');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to complete registration.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignUp() {
    setError(null);
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle();
      onNavigate('/account');
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Google sign-in could not be completed. You can register with email and password below.'
      );
    } finally {
      setGoogleSubmitting(false);
    }
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-5">
          <p className="text-xs font-medium text-[#59605B]">Start Recycling · Free Account</p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#171B19]">
            Create your KILN participant account.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[#3F4541]">
            Register to join the FUTO and Owerri community recycling pilot. Your account sets up
            your participant profile and reward wallet so you are ready to submit sorted plastic
            bottles, aluminium cans, paper, and cardboard as soon as collection scheduling opens.
          </p>

          <dl className="mt-8 pt-6 border-t border-[#DAD7CE] space-y-4 text-sm">
            <div>
              <dt className="font-semibold text-[#171B19]">Who can register</dt>
              <dd className="mt-0.5 text-[#59605B]">
                Students, households, hostels, and local businesses in FUTO, Ihiagwa, Eziobodo,
                Obinze, Umuchima, Nekede, and Owerri.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[#171B19]">What your account includes</dt>
              <dd className="mt-0.5 text-[#59605B]">
                Participant profile, community location settings, and an initialized reward wallet
                (0.00 pts until verified collections are approved).
              </dd>
            </div>
          </dl>
        </div>

        <div className="lg:col-span-7">
          <div className="bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold text-[#171B19]">Register</h2>
            <p className="mt-1 text-sm text-[#59605B]">
              Already have an account?{' '}
              <a
                href="/login"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/login');
                }}
                className="font-semibold text-[#17372D] underline underline-offset-4"
              >
                Sign in here
              </a>
              .
            </p>

            {error && (
              <div
                role="alert"
                className="mt-5 p-3.5 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm"
              >
                {error}
              </div>
            )}

            <div className="mt-6">
              <button
                type="button"
                disabled={googleSubmitting || submitting}
                onClick={handleGoogleSignUp}
                className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-[#171B19] bg-[#F7F6F2] hover:bg-[#EFECE4] border border-[#C9C5BA] rounded-sm transition-colors cursor-pointer disabled:opacity-60"
              >
                {googleSubmitting ? 'Connecting to Google...' : 'Continue with Google'}
              </button>

              <div className="my-6 flex items-center gap-4 text-xs text-[#59605B]">
                <div className="h-px bg-[#DAD7CE] flex-1" />
                <span>or register with email and password</span>
                <div className="h-px bg-[#DAD7CE] flex-1" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reg-fullname" className="block text-sm font-medium text-[#171B19]">
                  Full name
                </label>
                <input
                  id="reg-fullname"
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Chinedu Okafor"
                  className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reg-email" className="block text-sm font-medium text-[#171B19]">
                    Email address
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                  />
                </div>

                <div>
                  <label htmlFor="reg-phone" className="block text-sm font-medium text-[#171B19]">
                    Phone number <span className="text-[#59605B] font-normal">(optional)</span>
                  </label>
                  <input
                    id="reg-phone"
                    type="tel"
                    autoComplete="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+234 800 000 0000"
                    className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="reg-community" className="block text-sm font-medium text-[#171B19]">
                  Community area
                </label>
                <select
                  id="reg-community"
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reg-password" className="block text-sm font-medium text-[#171B19]">
                    Password
                  </label>
                  <input
                    id="reg-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="reg-confirm-password"
                    className="block text-sm font-medium text-[#171B19]"
                  >
                    Confirm password
                  </label>
                  <input
                    id="reg-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
                  />
                </div>
              </div>

              <p className="text-xs text-[#59605B]">
                Use at least 8 characters including both letters and numbers.
              </p>

              <div className="pt-2 flex items-start gap-3">
                <input
                  id="reg-terms"
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-[#17372D] cursor-pointer"
                />
                <label htmlFor="reg-terms" className="text-sm text-[#3F4541] leading-relaxed">
                  I agree to the KILN{' '}
                  <button
                    type="button"
                    onClick={() => onOpenLegal('terms')}
                    className="font-medium text-[#17372D] underline underline-offset-2 cursor-pointer"
                  >
                    Terms of Participation
                  </button>{' '}
                  and{' '}
                  <button
                    type="button"
                    onClick={() => onOpenLegal('privacy')}
                    className="font-medium text-[#17372D] underline underline-offset-2 cursor-pointer"
                  >
                    Privacy Policy
                  </button>
                  .
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting || googleSubmitting}
                className="w-full min-h-[46px] px-6 py-3 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm transition-colors cursor-pointer"
              >
                {submitting ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}

export function LoginPage({ onNavigate }: { onNavigate: (route: AppRoute, hash?: string) => void }) {
  const { loginWithEmail, loginWithGoogle } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const signedIn = await loginWithEmail(email, password);
      onNavigate(
        signedIn.role === 'ADMIN'
          ? '/admin'
          : signedIn.role === 'AGENT'
            ? '/agent'
            : '/collections'
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    setError(null);
    setGoogleSubmitting(true);
    try {
      const signedIn = await loginWithGoogle();
      onNavigate(
        signedIn.role === 'ADMIN'
          ? '/admin'
          : signedIn.role === 'AGENT'
            ? '/agent'
            : '/collections'
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Google sign-in could not be completed. Use your email and password below.'
      );
    } finally {
      setGoogleSubmitting(false);
    }
  }

  function fillDemoAccount(demoEmail: string, demoPassword: string) {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError(null);
  }

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20">
      <div className="max-w-lg mx-auto bg-white border border-[#DAD7CE] rounded-sm p-6 sm:p-8">
        <p className="text-xs font-medium text-[#59605B]">KILN Account Access</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-[#171B19]">
          Sign in to KILN
        </h1>
        <p className="mt-1.5 text-sm text-[#59605B]">
          New to KILN?{' '}
          <a
            href="/register"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/register');
            }}
            className="font-semibold text-[#17372D] underline underline-offset-4"
          >
            Start recycling by creating an account
          </a>
          .
        </p>

        {error && (
          <div
            role="alert"
            className="mt-5 p-3.5 text-sm text-[#7F2315] bg-[#FDF2F0] border border-[#E6B8B0] rounded-sm"
          >
            {error}
          </div>
        )}

        <div className="mt-6">
          <button
            type="button"
            disabled={googleSubmitting || submitting}
            onClick={handleGoogleLogin}
            className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-[#171B19] bg-[#F7F6F2] hover:bg-[#EFECE4] border border-[#C9C5BA] rounded-sm transition-colors cursor-pointer disabled:opacity-60"
          >
            {googleSubmitting ? 'Signing in with Google...' : 'Sign in with Google'}
          </button>

          <div className="my-6 flex items-center gap-4 text-xs text-[#59605B]">
            <div className="h-px bg-[#DAD7CE] flex-1" />
            <span>or sign in with email</span>
            <div className="h-px bg-[#DAD7CE] flex-1" />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-[#171B19]">
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-[#171B19]">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="mt-1.5 w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F6F2] border border-[#C9C5BA] rounded-sm text-[#171B19]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || googleSubmitting}
            className="w-full min-h-[46px] px-6 py-3 text-sm font-semibold text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] disabled:opacity-60 rounded-sm transition-colors cursor-pointer"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Clearly labelled Demo Accounts for Stage 3 role testing */}
        <div className="mt-8 pt-6 border-t border-[#E6E3DA]">
          <p className="text-xs font-semibold text-[#171B19]">
            Demo Accounts (Pilot Testing Only)
          </p>
          <p className="mt-1 text-xs text-[#59605B]">
            Use these seeded demo credentials to test Participant, Collection Agent, and
            Administrator workflows. Change or disable demo accounts before production deployment.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => fillDemoAccount('student@kiln.demo', 'KilnUser2026!')}
              className="min-h-[40px] px-3 py-2 text-xs font-medium text-[#17372D] bg-[#F7F6F2] hover:bg-[#EFECE4] border border-[#DAD7CE] rounded-sm text-left cursor-pointer"
            >
              <span className="block font-semibold">Participant</span>
              <span className="font-mono text-[11px] text-[#59605B]">student@kiln.demo</span>
            </button>
            <button
              type="button"
              onClick={() => fillDemoAccount('agent@kiln.demo', 'KilnAgent2026!')}
              className="min-h-[40px] px-3 py-2 text-xs font-medium text-[#17372D] bg-[#F7F6F2] hover:bg-[#EFECE4] border border-[#DAD7CE] rounded-sm text-left cursor-pointer"
            >
              <span className="block font-semibold">Agent</span>
              <span className="font-mono text-[11px] text-[#59605B]">agent@kiln.demo</span>
            </button>
            <button
              type="button"
              onClick={() => fillDemoAccount('admin@kiln.demo', 'KilnAdmin2026!')}
              className="min-h-[40px] px-3 py-2 text-xs font-medium text-[#17372D] bg-[#F7F6F2] hover:bg-[#EFECE4] border border-[#DAD7CE] rounded-sm text-left cursor-pointer"
            >
              <span className="block font-semibold">Admin</span>
              <span className="font-mono text-[11px] text-[#59605B]">admin@kiln.demo</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
