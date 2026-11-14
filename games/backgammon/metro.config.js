// Metro configuration for Expo.
// https://docs.expo.dev/guides/customizing-metro/
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Some dependencies ship CommonJS `.cjs` entrypoints; make sure Metro resolves them.
config.resolver.sourceExts.push('cjs');

// @mouro/realtime is a local package (file:../../packages/realtime), installed
// as a symlink that points outside this app. Metro only bundles files it
// watches, so watch that folder too.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../packages/realtime')];

// ── Disable Metro package-exports resolution (REQUIRED for the web build) ─────
// With package "exports" enabled (the SDK 54 default), Metro resolves some deps
// to their ESM build via the "import" condition. zustand v5's ESM — pulled in by
// `zustand/middleware` (for `persist`), and Metro does NOT tree-shake, so the
// devtools code comes along too — uses Vite-style `import.meta.env`. The web
// entry is served as a classic <script>, not type="module", so `import.meta` is
// a hard parse error ("Cannot use 'import.meta' outside a module") that kills
// hydration and leaves the app frozen on the prerendered "connecting…" screen.
// Disabling exports makes every platform use each package's classic CJS build
// (which uses process.env.NODE_ENV, not import.meta). Native was already fine —
// it resolves zustand's CJS build via the "react-native" export condition — so
// this only changes web..
//
// This is inherited verbatim from the gin rummy app, which was bitten by it in
// production. Do not "clean it up" without re-running the headless hydration
// check described in .claude/skills/deploy-web/SKILL.md.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
