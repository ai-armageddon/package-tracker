import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'USPS Tracking Notifier',
  description: 'Track USPS packages and get Telegram notifications',
  icons: { icon: 'https://www.usps.com/favicon.ico' },
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
              <img
                src="https://www.usps.com/global-elements/header/images/utility-header/logo-sb.svg"
                alt="USPS"
                className="h-8 w-auto"
              />
              <h1 className="text-xl font-bold tracking-tight">
                USPS Tracking Notifier
              </h1>
            </div>
            <span className="text-xs text-gray-500">via Telegram</span>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
