import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Root HTML for every web page — applied ONLY at web static export
 * (`expo export --platform web`). It is not used on native, and it renders
 * once at build time, so it must stay static: no hooks, state, browser APIs,
 * or per-route logic here.
 *
 * We use it to turn the exported site into an installable PWA: the web app
 * manifest plus the iOS "Add to Home Screen" meta tags. There is deliberately
 * NO service worker (see README → "Web / PWA").
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets the felt reach behind the iPhone notch/home bar.
            Zoom is disabled so pinch gestures don't fight the card drag gestures. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />

        {/* ── Installable PWA ─────────────────────────────────────────────── */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#12362a" />

        {/* iOS: standalone launch + home-screen icon + title */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Gin Rummy" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

        {/*
          Disable body scrolling on web so the fixed-height game table doesn't
          bounce. This must be added since the root <body> is undefined on native.
        */}
        <ScrollViewStyleReset />

        {/* Lock the page background to the felt green so there's no white flash
            before React mounts, in either colour scheme. */}
        <style dangerouslySetInnerHTML={{ __html: backgroundStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const backgroundStyle = `
html, body { background-color: #12362a; }
@media (prefers-color-scheme: dark) {
  html, body { background-color: #12362a; }
}`;
