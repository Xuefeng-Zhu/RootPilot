'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  BellIcon,
  DeploymentsIcon,
  ErrorGroupsIcon,
  LogsIcon,
  MetricsIcon,
  OverviewIcon,
  RootPilotMark,
  SearchIcon,
  ServiceMapIcon,
  ServicesIcon,
  SettingsIcon,
  TracesIcon,
  UserIcon,
} from './icons';

const navItems = [
  { href: '/', label: 'Overview', icon: OverviewIcon },
  { href: '/service-map', label: 'Service Map', icon: ServiceMapIcon },
  { href: '/logs', label: 'Logs', icon: LogsIcon },
  { href: '/traces', label: 'Traces', icon: TracesIcon },
  { href: '/metrics', label: 'Metrics', icon: MetricsIcon },
  { href: '/services', label: 'Services', icon: ServicesIcon },
  { href: '/deployments', label: 'Deployments', icon: DeploymentsIcon },
  { href: '/error-groups', label: 'Error Groups', icon: ErrorGroupsIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

const routeTitles: Array<[string, string]> = [
  ['/service-map', 'Service Map'],
  ['/logs', 'Logs Explorer'],
  ['/traces', 'Traces Explorer'],
  ['/metrics', 'Metrics Explorer'],
  ['/services', 'Services'],
  ['/deployments', 'Deployments'],
  ['/error-groups', 'Error Groups'],
  ['/settings', 'Settings'],
  ['/', 'Overview'],
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const title = useMemo(
    () =>
      routeTitles.find(([prefix]) =>
        prefix === '/' ? pathname === '/' : pathname.startsWith(prefix),
      )?.[1] ?? 'RootPilot',
    [pathname],
  );

  return (
    <div className="flex h-screen">
      <Sidebar pathname={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} />
        <main className="min-w-0 flex-1 overflow-y-auto px-5 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}

export function Sidebar({ pathname }: { pathname?: string }) {
  const currentPath = pathname ?? '/';

  return (
    <aside className="hidden h-screen w-[236px] shrink-0 flex-col border-r border-surface-border bg-sidebar-bg/95 lg:flex">
      <div className="flex items-center gap-3 px-4 py-4">
        <RootPilotMark />
        <div>
          <div className="text-base font-semibold tracking-tight text-white">RootPilot</div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300/70">Telemetry</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-3" aria-label="Primary navigation">
        {navItems.map((item) => {
          const isActive =
            item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href);
          const IconComponent = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link ${isActive ? 'nav-link-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <IconComponent className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-surface-border p-3">
        <div className="grid grid-cols-2 gap-2">
          <button className="rp-button h-9 px-2" aria-label="Command menu">
            ⌘
          </button>
          <button className="rp-button h-9 px-2" aria-label="Quick switcher">
            ⇄
          </button>
        </div>
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md border border-surface-border bg-surface-subtle px-3 py-2 text-left text-sm text-slate-200 hover:border-cyan-400/40"
        >
          <span>
            <span className="block font-medium">Acme Corp</span>
            <span className="block text-xs text-slate-500">Production workspace</span>
          </span>
          <span className="text-slate-500">⌄</span>
        </button>
      </div>
    </aside>
  );
}

function Header({ title }: { title: string }) {
  const [query, setQuery] = useState('');
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-surface-border bg-surface/72 px-5 backdrop-blur lg:px-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{title}</p>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        <label className="relative hidden w-full max-w-xs md:block">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search telemetry..."
            aria-label="Search telemetry"
            className="rp-input h-9 w-full pl-9"
          />
        </label>
        <select aria-label="Global time range" className="rp-input hidden h-9 w-32 md:block">
          <option>Last 15 minutes</option>
          <option>Last 1 hour</option>
          <option>Last 24 hours</option>
          <option>Last 7 days</option>
        </select>
        <select aria-label="Global environment" className="rp-input hidden h-9 w-28 md:block">
          <option>prod</option>
          <option>staging</option>
          <option>dev</option>
        </select>
        <IconButton label="Notifications">
          <BellIcon className="h-4 w-4" />
        </IconButton>
        <Link href="/settings" className="rp-button h-9 w-9 p-0" aria-label="Settings">
          <SettingsIcon className="h-4 w-4" />
        </Link>
        <IconButton label="User profile">
          <UserIcon className="h-4 w-4" />
        </IconButton>
      </div>
    </header>
  );
}

function IconButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button type="button" className="rp-button h-9 w-9 p-0" aria-label={label}>
      {children}
    </button>
  );
}
