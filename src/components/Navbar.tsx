import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AppRoute } from '../types/kiln';

interface NavbarProps {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute, hash?: string) => void;
}

const PUBLIC_NAV_ITEMS: Array<{ label: string; route: AppRoute; hash?: string }> = [
  { label: 'About', route: '/', hash: '#about' },
  { label: 'How It Works', route: '/', hash: '#how-it-works' },
  { label: 'Materials', route: '/', hash: '#materials' },
  { label: 'Pilot', route: '/', hash: '#pilot' },
  { label: 'Learn', route: '/', hash: '#learn' },
];

export function Navbar({ currentRoute, onNavigate }: NavbarProps) {
  const { user, loading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = (route: AppRoute, hash?: string) => {
    setMobileMenuOpen(false);
    onNavigate(route, hash);
  };

  const authNavItems: Array<{ label: string; route: AppRoute; hash?: string }> = user
    ? [
        { label: 'Collections', route: '/collections' },
        {
          label:
            user.unreadNotifications > 0
              ? `Wallet (${user.unreadNotifications})`
              : 'Wallet',
          route: '/wallet',
        },
        { label: 'Learn & AI', route: '/learn' },
        ...(user.role === 'AGENT'
          ? [{ label: 'Agent Desk', route: '/agent' as AppRoute }]
          : user.role === 'ADMIN'
            ? [{ label: 'Admin Console', route: '/admin' as AppRoute }]
            : []),
        { label: 'Account', route: '/account' },
      ]
    : PUBLIC_NAV_ITEMS;

  const primaryActionRoute: AppRoute = !user
    ? '/register'
    : user.role === 'ADMIN'
      ? '/admin'
      : user.role === 'AGENT'
        ? '/agent'
        : '/collections';

  const primaryActionLabel = !user
    ? 'Start Recycling'
    : user.role === 'ADMIN'
      ? 'Operations Console'
      : user.role === 'AGENT'
        ? 'Agent Assignments'
        : 'Request Collection';

  return (
    <header className="sticky top-0 z-40 bg-[#F7F6F2]/95 backdrop-blur-sm border-b border-[#DAD7CE]">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single clean wordmark */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            handleLinkClick('/');
          }}
          className="font-display text-xl font-bold tracking-tight text-[#17372D] whitespace-nowrap shrink-0"
        >
          KILN
        </a>

        {/* Zone 2: 4-5 concise single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden lg:flex items-center gap-7 text-sm font-medium text-[#3F4541]"
        >
          {authNavItems.map((item) => {
            const isActive = !item.hash && currentRoute === item.route;
            return (
              <a
                key={`${item.route}${item.hash ?? ''}`}
                href={`${item.route}${item.hash ?? ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleLinkClick(item.route, item.hash);
                }}
                className={`transition-colors duration-150 whitespace-nowrap shrink-0 underline-offset-4 hover:underline ${
                  isActive
                    ? 'text-[#17372D] font-semibold underline'
                    : 'hover:text-[#17372D]'
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action (+ quiet Sign In text link when logged out) */}
        <div className="hidden lg:flex items-center gap-5 shrink-0">
          {!loading && !user && (
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                handleLinkClick('/login');
              }}
              className={`text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 ${
                currentRoute === '/login'
                  ? 'text-[#17372D] underline underline-offset-4'
                  : 'text-[#3F4541] hover:text-[#17372D] hover:underline underline-offset-4'
              }`}
            >
              Sign In
            </a>
          )}
          <button
            type="button"
            onClick={() => handleLinkClick(primaryActionRoute)}
            className="px-4 py-2 text-sm font-medium text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {primaryActionLabel}
          </button>
        </div>

        {/* Mobile Menu Trigger (>= 44px touch target) */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-nav-panel"
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className="lg:hidden inline-flex items-center justify-center w-11 h-11 text-[#171B19] hover:text-[#17372D] rounded-sm border border-[#DAD7CE] bg-[#F7F6F2] cursor-pointer shrink-0"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-panel"
          className="lg:hidden border-t border-[#DAD7CE] bg-[#F7F6F2] px-4 pt-3 pb-5"
        >
          <nav aria-label="Mobile navigation" className="flex flex-col divide-y divide-[#E5E2D9]">
            {authNavItems.map((item) => (
              <a
                key={`${item.route}${item.hash ?? ''}`}
                href={`${item.route}${item.hash ?? ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  handleLinkClick(item.route, item.hash);
                }}
                className="py-3 text-base font-medium text-[#171B19] hover:text-[#17372D] min-h-[44px] flex items-center"
              >
                {item.label}
              </a>
            ))}
            {!user && (
              <a
                href="/#partners"
                onClick={(e) => {
                  e.preventDefault();
                  handleLinkClick('/', '#partners');
                }}
                className="py-3 text-base font-medium text-[#171B19] hover:text-[#17372D] min-h-[44px] flex items-center"
              >
                Partners &amp; Contact
              </a>
            )}
          </nav>

          <div className="mt-4 pt-4 border-t border-[#DAD7CE] flex flex-col gap-3">
            <button
              type="button"
              onClick={() => handleLinkClick(primaryActionRoute)}
              className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-[#F7F6F2] bg-[#17372D] hover:bg-[#14532D] rounded-sm cursor-pointer"
            >
              {primaryActionLabel}
            </button>
            {!loading && !user && (
              <button
                type="button"
                onClick={() => handleLinkClick('/login')}
                className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-[#17372D] border border-[#17372D] hover:bg-[#EFECE4] rounded-sm cursor-pointer"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
