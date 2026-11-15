/**
 * The realtime singletons. Every other module imports `auth` / `db` from here.
 * The anonymous identity token persists in localStorage, so a reload keeps the
 * same uid — which is what keeps a player in their seat.
 */
import { initializeRealtime } from '@mouro/realtime';
import { REALTIME_DATABASE, realtimeUrl } from '@/net/config';

const realtime = initializeRealtime({ database: REALTIME_DATABASE, url: realtimeUrl });

export const auth = realtime.auth;
export const db = realtime.db;
