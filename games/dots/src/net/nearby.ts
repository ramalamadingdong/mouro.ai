/**
 * "On your Wi-Fi": waiting rooms hosted from the same network.
 *
 * The realtime server matches players who reach it from one public address
 * (or one IPv6 home prefix) and answers with code, host name and player count
 * only. It never stores the address or sends it to anyone. A room is listed
 * while its host sits in the lobby with the switch on, and disappears when the
 * game starts, the host leaves, or the connection drops.
 */
import { useEffect, useState } from 'react';
import { announceNearbyRoom, listNearbyRooms, type NearbyRoom } from '@mouro/realtime';
import { db } from '@/net/realtime';

const POLL_MS = 5000;

/** Rooms waiting on the same network, refreshed every few seconds while the page is visible. */
export function useNearbyRooms(enabled: boolean): NearbyRoom[] {
  const [rooms, setRooms] = useState<NearbyRoom[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      listNearbyRooms(db)
        .then((found) => {
          if (live) setRooms(found);
        })
        .catch(() => {
          // Offline or not signed in yet: the list just stays as it was.
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [enabled]);
  return enabled ? rooms : [];
}

/** Keep the host's waiting room listed; `null` withdraws it. */
export function useAnnounceRoom(room: NearbyRoom | null): void {
  const code = room?.code ?? null;
  const name = room?.name ?? '';
  const players = room?.players ?? 0;
  useEffect(() => {
    if (!code) return;
    announceNearbyRoom(db, { code, name, players }).catch(() => {
      // Not listed this time; joining by link or code still works.
    });
    return () => {
      announceNearbyRoom(db, null).catch(() => {});
    };
  }, [code, name, players]);
}
