import { Platform } from 'react-native';

/**
 * Where the realtime server lives.
 *
 * On the web the game is served from mouro.ai and the server sits behind the
 * same host at /rt, so nothing needs configuring: the client derives
 * wss://<host>/rt from the page's location. Native builds (Expo Go, EAS) have
 * no page location, so they read EXPO_PUBLIC_REALTIME_URL at build time
 * (e.g. wss://mouro.ai/rt).
 *
 * REALTIME_DATABASE selects this game's namespace and security rules on the
 * server (see server/games.json).
 */
export const REALTIME_DATABASE = 'gin-rummy';

export const realtimeUrl: string | undefined = process.env.EXPO_PUBLIC_REALTIME_URL || undefined;

/** Online play is available on the web always, and natively once a URL is set. */
export const isOnlineConfigured: boolean = Platform.OS === 'web' || !!realtimeUrl;
