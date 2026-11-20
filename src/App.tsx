import { useCallback, useEffect, useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { PublicHomePage } from './components/PublicHomePage';
import { LoginPage, RegisterPage } from './components/AuthPages';
import { AccountPage } from './components/AccountPage';
import { CollectionsPage } from './components/CollectionsPage';
import { AgentDashboardPage } from './components/AgentDashboardPage';
import { AdminCollectionsPage } from './components/AdminCollectionsPage';
import { WalletPage } from './components/WalletPage';
import { LearnAndSorterPage } from './components/LearnAndSorterPage';
import { Footer } from './components/Footer';
import { LegalModal, type LegalDocType } from './components/LegalModal';
import type { AppRoute } from './types/kiln';

function resolvePathToRoute(pathname: string): AppRoute {
  if (pathname === '/login') return '/login';
  if (pathname === '/register') return '/register';
  if (pathname === '/account') return '/account';
  if (pathname === '/collections') return '/collections';
  if (pathname === '/wallet') return '/wallet';
  if (pathname === '/learn') return '/learn';
  if (pathname === '/agent') return '/agent';
  if (pathname === '/admin') return '/admin';
  return '/';
}

function KilnShell() {
  const [route, setRoute] = useState<AppRoute>(() =>
    resolvePathToRoute(window.location.pathname)
  );
  const [legalDoc, setLegalDoc] = useState<LegalDocType>(null);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(resolvePathToRoute(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute, hash?: string) => {
    const targetUrl = hash ? `${nextRoute}${hash}` : nextRoute;
    if (window.location.pathname + window.location.hash !== targetUrl) {
      window.history.pushState({}, '', targetUrl);
    }
    setRoute(nextRoute);

    if (hash) {
      const id = hash.replace(/^#/, '');
      window.requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F6F2] text-[#171B19]">
      <Navbar currentRoute={route} onNavigate={navigate} />

      <div className="flex-1">
        {route === '/' && <PublicHomePage onNavigate={navigate} />}
        {route === '/register' && (
          <RegisterPage onNavigate={navigate} onOpenLegal={setLegalDoc} />
        )}
        {route === '/login' && <LoginPage onNavigate={navigate} />}
        {route === '/account' && <AccountPage onNavigate={navigate} />}
        {route === '/collections' && <CollectionsPage onNavigate={navigate} />}
        {route === '/wallet' && <WalletPage onNavigate={navigate} />}
        {route === '/learn' && <LearnAndSorterPage onNavigate={navigate} />}
        {route === '/agent' && <AgentDashboardPage onNavigate={navigate} />}
        {route === '/admin' && <AdminCollectionsPage onNavigate={navigate} />}
      </div>

      <Footer onNavigate={navigate} onOpenLegal={setLegalDoc} />
      <LegalModal docType={legalDoc} onClose={() => setLegalDoc(null)} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <KilnShell />
    </AuthProvider>
  );
}
