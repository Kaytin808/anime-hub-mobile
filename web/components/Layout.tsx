import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState, type ReactNode } from 'react';
import { Home, Library, Search, Settings, CheckCircle2, UserCircle2 } from 'lucide-react';
import { useRealDebrid } from '../context/RealDebridContext';
import RDAuthModal from './RDAuthModal';

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { token, status, startAuth, disconnect, pollError } = useRealDebrid();
  const [showRDModal, setShowRDModal] = useState(false);
  const [query, setQuery] = useState('');

  const navItems = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/library', label: 'Library', icon: Library },
    { href: '/settings', label: 'Settings', icon: Settings }
  ];

  useEffect(() => {
    if (router.pathname !== '/search') return;
    const searchQuery = Array.isArray(router.query.q) ? router.query.q[0] : router.query.q || '';
    setQuery(searchQuery);
  }, [router.pathname, router.query.q]);

  return (
    <div className="appShell">
      <aside className="sidebar">
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = router.pathname === item.href;
            return (
            <Link
              key={item.href}
              href={item.href}
              className={isActive ? 'active' : ''}
              title={item.label}
            >
              <Icon size={22} />
              <span className="sidebarLabel">{item.label}</span>
            </Link>
          )})}
        </nav>
      </aside>

      <div className="mainArea">
        <header className="topBar">
          <form
            className="topSearch"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = query.trim();
              if (trimmed) {
                void router.push(`/search?q=${encodeURIComponent(trimmed)}`);
              }
            }}
          >
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label="Search"
            />
          </form>

          <div className="topActions">
            <button
              className={status === 'connected' ? 'rdPill connected' : 'rdPill'}
              onClick={() => (status === 'connected' ? (token ? disconnect() : undefined) : setShowRDModal(true))}
              title={status === 'connected' ? 'RealDebrid connected' : 'Connect RealDebrid account'}
            >
              {status === 'connected' ? <CheckCircle2 size={17} /> : <UserCircle2 size={17} />}
              <span>{status === 'connected' ? 'RD Connected' : status === 'waiting' ? 'Authorizing' : 'Connect RD'}</span>
            </button>
            <div className="windowDots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </header>
        {pollError && <div className="topNotice">{pollError}</div>}
        <div className="content">{children}</div>
      </div>

      {showRDModal && (
        <RDAuthModal
          onClose={() => setShowRDModal(false)}
          onStartAuth={startAuth}
          status={status}
        />
      )}
    </div>
  );
}
