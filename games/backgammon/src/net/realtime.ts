/**
 * The realtime singletons. Every other module imports `auth` / `db` from here.
 *
 * The anonymous identity token persists in localStorage on the web and in
 * AsyncStorage natively, so a reload or cold start keeps the same uid — which
 * is what keeps a player in their seat.
 *
 * Importing this is side-effect free: no socket opens until the first read,
 * write or sign-in, so static web prerendering in Node stays safe.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { initializeRealtime } from '@mouro/realtime';
import { REALTIME_DATABASE, realtimeUrl } from '@/net/config';

const realtime = initializeRealtime({
  database: REALTIME_DATABASE,
  url: realtimeUrl,
  storage: Platform.OS === 'web' ? undefined : AsyncStorage,
});

export const auth = realtime.auth;
export const db = realtime.db;
