// Metro configuration for Expo.
// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// The Firebase JS SDK ships some CommonJS entrypoints; make sure Metro resolves
// `.cjs` files. This is harmless for the rest of the app.
config.resolver.sourceExts.push('cjs');

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
// this only changes web. It also sidesteps the known Firebase "Component auth
// has not been registered yet" interaction.
//
// This is inherited verbatim from the gin rummy app, which was bitten by it in
// production. Do not "clean it up" without re-running the headless hydration
// check described in .claude/skills/deploy-web/SKILL.md.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
