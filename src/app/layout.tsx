import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Package Tracking Notifier',
  description: 'Track USPS & FedEx packages and get Telegram notifications',
  icons: { icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📦</text></svg>' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <header className="border-b border-gray-800 bg-gray-900">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📦</span>
              <h1 className="text-xl font-bold tracking-tight">
                Package Tracking
              </h1>
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 72 24" className="h-5 w-auto" aria-label="USPS">
                  <rect width="72" height="24" rx="5" fill="#004B87"/>
                  <text x="36" y="16.5" textAnchor="middle" fontFamily="Arial,Helvetica,sans-serif" fontWeight="900" fontSize="12.5" fill="white" letterSpacing="1">USPS</text>
                </svg>
                <svg viewBox="0 0 86 24" className="h-5 w-auto" aria-label="FedEx">
                  <rect width="86" height="24" rx="5" fill="#1a0f24"/>
                  <text x="5" y="17" fontFamily="'Arial Black',Arial,Helvetica,sans-serif" fontWeight="900" fontSize="14" fill="#4D148C">Fed</text>
                  <text x="41" y="17" fontFamily="'Arial Black',Arial,Helvetica,sans-serif" fontWeight="900" fontSize="14" fill="#FF6600">Ex</text>
                </svg>
              </div>
            </div>
            <span className="text-xs text-gray-500">via Telegram</span>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
