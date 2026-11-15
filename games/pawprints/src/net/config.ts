/**
 * Where the realtime server lives.
 *
 * The app is served from mouro.ai and the server sits behind the same host at
 * /rt, so by default the client derives wss://<host>/rt from the page. Set
 * VITE_REALTIME_URL to point a dev build elsewhere (e.g. ws://localhost:8787/rt
 * while running `npm start` in server/).
 *
 * REALTIME_DATABASE selects this game's namespace and security rules on the
 * server (see server/games.json).
 */
export const REALTIME_DATABASE = 'pawprints';

export const realtimeUrl: string | undefined = import.meta.env.VITE_REALTIME_URL || undefined;

/** The web build can always reach the server it was served from. */
export const isOnlineConfigured = true;
