/**
 * The router.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BASENAME vs BASE — two conventions for one deployment path:
 *
 *   vite.config.ts      base:     '/holdem/'   <- leading AND trailing slash
 *   this file           basename: '/holdem'    <- leading slash, NO trailing
 *
 * Vite's `base` is a prefix glued onto asset filenames, so it needs the
 * trailing slash. React Router's `basename` is a segment stripped from the
 * path before matching, and a trailing slash there makes '/' unmatchable.
 * Out of step, the failure is a blank page whose assets all load fine — so
 * the basename below is DERIVED from `import.meta.env.BASE_URL`, never typed.
 * Change the path in vite.config.ts alone (and in infra/Caddyfile).
 * ────────────────────────────────────────────────────────────────────────────
 */
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useMatch } from 'react-router-dom';
import { useGameStore } from '@/store/gameStore';
import { sanitizeRoomCode } from '@/util/seed';
import { GameRoute } from '@/routes/game';
import { HomeRoute } from '@/routes/home';
import { JoinRoute } from '@/routes/join';
import { LobbyRoute } from '@/routes/lobby';
import { SoloRoute } from '@/routes/solo';

/**
 * THE ONE OWNER OF THE ROOM SUBSCRIPTION (same structure as yahtzee).
 *
 * /lobby/:code and /game/:code are children of this pathless layout, so
 * moving between them keeps ONE binding alive — no reconnect flash at the
 * lobby → table handoff — while leaving the subtree by any means (Back, the
 * OS gesture, the Leave button) unmounts it and closes the room listener and
 * the presence writer. A pathless layout has no params of its own, hence
 * `useMatch` rather than `useParams`.
 */
function RoomLayout() {
  const lobbyMatch = useMatch('/lobby/:code');
  const gameMatch = useMatch('/game/:code');
  const code = sanitizeRoomCode(lobbyMatch?.params.code ?? gameMatch?.params.code ?? '');
  const bindRoom = useGameStore((s) => s.bindRoom);
  const unbindRoom = useGameStore((s) => s.unbindRoom);

  useEffect(() => {
    if (!code) return;
    bindRoom(code);
    return () => unbindRoom();
  }, [code, bindRoom, unbindRoom]);

  return <Outlet />;
}

const router = createBrowserRouter(
  [
    { path: '/', element: <HomeRoute /> },
    // Offline, against the cats. Needs no connection and no room.
    { path: '/solo', element: <SoloRoute /> },
    // '/join' is "type a code"; '/join/:code' is the invite link, which
    // prefills and joins by itself.
    { path: '/join', element: <JoinRoute /> },
    { path: '/join/:code', element: <JoinRoute /> },
    {
      element: <RoomLayout />,
      children: [
        { path: '/lobby/:code', element: <LobbyRoute /> },
        { path: '/game/:code', element: <GameRoute /> },
      ],
    },
    // `replace` so a bad URL does not sit on the history stack.
    { path: '*', element: <Navigate to="/" replace /> },
  ],
  {
    // Static dot access is required: Vite substitutes `import.meta.env.BASE_URL`
    // as literal text at build time. `|| '/'` covers a root deployment.
    basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
  },
);

export function App() {
  return <RouterProvider router={router} />;
}
