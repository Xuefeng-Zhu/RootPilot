import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '../components/app-shell';

export const metadata: Metadata = {
  title: 'RootPilot',
  description: 'OpenTelemetry-native observability platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="rp-shell-bg h-screen overflow-hidden text-slate-100">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
