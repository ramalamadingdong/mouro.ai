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
  // Expo inlines EXPO_BASE_URL (from app.json → experiments.baseUrl) at web
  // export time: a leading-slash / no-trailing-slash prefix like "/gin-rummy",
  // or "" when the site is hosted at the domain root. Expo auto-prefixes its OWN
  // <script>/<link> tags with it, but NOT the hand-written asset links below, so
  // we prefix them ourselves — otherwise a sub-path deploy (mouro.ai/gin-rummy)
  // would request them from the domain root and miss.
  const baseUrl = process.env.EXPO_BASE_URL ?? '';
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
        <link rel="manifest" href={`${baseUrl}/manifest.json`} />
        <meta name="theme-color" content="#12362a" />

        {/* iOS: standalone launch + home-screen icon + title */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Gin Rummy" />
        <link rel="apple-touch-icon" href={`${baseUrl}/icons/apple-touch-icon.png`} />

        {/* Link previews (Slack, iMessage, WhatsApp). Absolute addresses, because
            previews need them. The card is drawn by scripts/render-share-cards.mjs
            at the repo root and lives with the site. */}
        <meta property="og:title" content="Gin Rummy" />
        <meta property="og:description" content="Classic two-player gin rummy with no sign-up: share a room code and play a friend online, or play Marmalade, a computer cat." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://mouro.ai/gin-rummy/" />
        <meta property="og:site_name" content="Mouro Games" />
        <meta property="og:image" content="https://mouro.ai/static/share/gin-rummy.png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Gin Rummy, online or against a computer cat" />
        <meta name="twitter:card" content="summary_large_image" />

        {/*
          Disable body scrolling on web so the fixed-height game table doesn't
          bounce. This must be added since the root <body> is undefined on native.
        */}
        <ScrollViewStyleReset />

        {/* Lock the page background to the felt green so there's no white flash
            before React mounts, in either colour scheme. */}
        <style dangerouslySetInnerHTML={{ __html: backgroundStyle }} />
        {/* Analytics (self-hosted Umami, cookieless): see site/static/js/analytics.js */}
        <script defer src="https://mouro.ai/static/js/analytics.js" />
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
