import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import Script from 'next/script';
import { Bricolage_Grotesque, Instrument_Sans, Martian_Mono } from 'next/font/google';
import { AppShell } from '@/components/AppShell';
import { parseTheme, THEME_COOKIE, themeAttribute } from '@/lib/theme';
import { Providers } from './providers';
import './globals.css';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});

const body = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
});

/** Every number on this site is box-office data: prices, seats left, minutes left. */
const mono = Martian_Mono({
  subsets: ['latin'],
  variable: '--font-martian',
  weight: ['400', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'lockmyticket', template: '%s · lockmyticket' },
  description: 'Find live events across India and hold your seat while you pay.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eceef2' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c14' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read here so the first byte already carries the right palette — no
  // blocking inline script, no flash of the wrong theme (see lib/theme.ts).
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const attribute = themeAttribute(theme);

  return (
    <html
      lang="en"
      {...(attribute ? { 'data-theme': attribute } : {})}
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
        >
          Skip to content
        </a>
        <Providers theme={theme}>
          <AppShell>
            <div id="main">{children}</div>
          </AppShell>
        </Providers>
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      </body>
    </html>
  );
}
