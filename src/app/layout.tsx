import type { Metadata } from 'next';
import { execSync } from 'child_process';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import './globals.css';

function getVersion() {
  try {
    const n = parseInt(execSync('git rev-list --count HEAD').toString().trim(), 10);
    return `v${Math.floor(n / 100)}.${Math.floor((n % 100) / 10)}.${n % 10}`;
  } catch {
    return 'v1.0.0';
  }
}

export const metadata: Metadata = {
  title: 'Package Tracker',
  description: 'Track packages across carriers and get Telegram notifications',
  icons: { icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📦</text></svg>' },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const signedIn = await verifySessionToken(cookies().get(AUTH_COOKIE_NAME)?.value);

  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen flex flex-col antialiased">
        <header className="sticky top-0 z-30 border-b border-gray-800/70 bg-gray-950/80 backdrop-blur-md">
          <div className="max-w-4xl mx-auto px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-700/60 bg-gradient-to-br from-blue-500/25 via-gray-900 to-purple-500/20 text-lg shadow-inner">
                📦
              </span>
              <div className="min-w-0">
                <h1 className="text-[15px] font-semibold leading-tight tracking-tight">
                  Package Tracking
                </h1>
                <p className="text-[11px] leading-tight text-gray-500">
                  USPS · FedEx · UPS
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-gray-500 sm:inline">
                Telegram alerts
              </span>
              <span className="rounded-full border border-purple-500/25 bg-purple-500/10 px-2 py-0.5 font-mono text-[11px] text-purple-300/90">
                {getVersion()}
              </span>
              {signedIn && (
                <form action="/api/auth/logout" method="post">
                  <button
                    type="submit"
                    className="rounded-md border border-gray-700/80 px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:border-gray-600 hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  >
                    Sign out
                  </button>
                </form>
              )}
            </div>
          </div>
        </header>
        <main className="max-w-4xl mx-auto w-full px-4 py-8 flex-1">{children}</main>
        <footer className="border-t border-gray-800/70 mt-auto">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between text-xs text-gray-600">
            <span>&copy; {new Date().getFullYear()} ai-armageddon</span>
            <a href="https://github.com/ai-armageddon/package-tracker" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-300 transition-colors">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16" aria-label="GitHub">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
