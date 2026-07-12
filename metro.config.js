// Metro configuration for Expo.
// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// The Firebase JS SDK ships some CommonJS entrypoints; make sure Metro resolves
// `.cjs` files. This is harmless for the rest of the app.
config.resolver.sourceExts.push('cjs');

// ── Firebase troubleshooting fallback ────────────────────────────────────────
// If you ever see "Component auth has not been registered yet" or an
// "INTERNAL ASSERTION FAILED" from Firebase at runtime, uncomment the next line
// to disable Metro's package-exports resolution (a known Firebase + Metro
// interaction). Not needed with firebase@^12 on Expo SDK 54 in normal cases.
// config.resolver.unstable_enablePackageExports = false;

module.exports = config;
