/**
 * The router, plus the one piece of global chrome the whole app shares: the
 * `--ui-scale` custom property.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE BASENAME / BASE MISMATCH IS INTENTIONAL — AND IS NOW DERIVED, NOT TYPED.
 *
 *   vite.config.ts      base:     '/yahtzee/'   <- leading AND trailing slash
 *   this file           basename: '/yahtzee'    <- leading slash, NO trailing
 *
 * They are two different conventions for the same deployment path. Vite's `base`
 * is a URL prefix concatenated onto asset filenames, so it needs the trailing
 * slash. React Router's `basename` is a path segment it *strips* from
 * `location.pathname` before matching, and a trailing slash there makes '/'
 * unmatchable — every route falls through to the catch-all.
 *
 * Get them out of step and the failure is maximally confusing: the HTML loads,
 * the JS and CSS load (correct `base`), React mounts, and the page is blank,
 * because the router matched nothing. That is precisely why the value below is
 * computed from `import.meta.env.BASE_URL` rather than written out again: two
 * literals for one deployment path can disagree, and this is the hardest
 * failure in the app to diagnose. Change the path in vite.config.ts alone.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { useEffect } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useMatch,
} from 'react-router-dom';
import { useResponsiveScale } from '@/hooks/use-responsive-scale';
import { useGameStore } from '@/store/gameStore';
import { sanitizeRoomCode } from '@/util/seed';
import { HomeRoute } from '@/routes/home';
import { JoinRoute } from '@/routes/join';
import { LobbyRoute } from '@/routes/lobby';
import { GameRoute } from '@/routes/game';
import { LocalRoute } from '@/routes/local';

/**
 * THE ONE OWNER OF THE ROOM SUBSCRIPTION.
 *
 * `bindRoom` opens four long-lived things in module scope — the `rooms/<code>`
 * onValue, the `.info/connected` onValue, an onAuthStateChanged, and the
 * presence writer that keeps stamping us `online: true`. Something has to close
 * them on the way out.
 *
 * It cannot be the lobby or the table, because the lobby -> table handoff must
 * NOT drop and re-open the socket (it flashes both screens through their
 * connecting state). When each route owned its own bind, the only way to make
 * that handoff cheap was to omit the cleanup entirely — which meant every exit
 * that was not the in-app Leave button (browser Back, the PWA's OS back
 * gesture, any history navigation to Home) left all four alive forever, and
 * opponents kept seeing a green dot for a player who had left.
 *
 * A layout route fixes it structurally instead of by convention: /lobby/:code
 * and /game/:code are its children, so moving between them keeps this ONE
 * component — and therefore this one effect and one binding — mounted, while
 * leaving the subtree by ANY means unmounts it and tears down deterministically.
 *
 * PATHLESS on purpose. Giving the parent a path pattern that spans both
 * children would need something like ':view/:code', which would also swallow
 * every two-segment typo that should fall through to the catch-all. The code is
 * read back out with `useMatch` instead: a pathless layout contributes no
 * params of its own, so `useParams()` here would be empty.
 */
function RoomLayout() {
  const lobbyMatch = useMatch('/lobby/:code');
  const gameMatch = useMatch('/game/:code');
  // Sanitized here as well as in each child, because this value is what decides
  // which room we open listeners on; the children only display it.
  const code = sanitizeRoomCode(lobbyMatch?.params.code ?? gameMatch?.params.code ?? '');

  const bindRoom = useGameStore((s) => s.bindRoom);
  const unbindRoom = useGameStore((s) => s.unbindRoom);

  useEffect(() => {
    if (!code) return;
    bindRoom(code);
    return () => unbindRoom();
    // Keyed on `code`: /game/A -> /game/B is a real room change and must rebind,
    // but /lobby/A -> /game/A leaves this array untouched and the effect alone.
  }, [code, bindRoom, unbindRoom]);

  return <Outlet />;
}

const router = createBrowserRouter(
  [
    { path: '/', element: <HomeRoute /> },

    // Two entries rather than one optional param: '/join' is the "type a code"
    // screen and '/join/:code' is the invite-link landing, which prefills and
    // auto-joins. One component serves both; the param is what distinguishes
    // "the player came here to type" from "a friend sent this link".
    { path: '/join', element: <JoinRoute /> },
    { path: '/join/:code', element: <JoinRoute /> },

    // Both room screens sit UNDER RoomLayout so the binding survives the
    // lobby -> table handoff and dies on any exit. Do not lift either of these
    // back to the top level without moving its bind/unbind with it.
    {
      element: <RoomLayout />,
      children: [
        { path: '/lobby/:code', element: <LobbyRoute /> },
        { path: '/game/:code', element: <GameRoute /> },
      ],
    },

    { path: '/local', element: <LocalRoute /> },

    // Catch-all. `replace` so the bad URL does not stay on the history stack and
    // send the player straight back to it when they press Back.
    { path: '*', element: <Navigate to="/" replace /> },
  ],
  {
    /*
     * DERIVED, never typed twice. Vite's `base` ('/yahtzee/') is the single
     * source of truth for the deployment path and every asset URL already comes
     * from it; a hand-written '/yahtzee' here was a second copy that would
     * silently rot the day the app moved. Stripping the trailing slash
     * reproduces React Router's convention by construction, and the `|| '/'`
     * covers a root deployment, where BASE_URL is '/' and stripping leaves ''
     * (which React Router rejects).
     *
     * Static dot notation on `import.meta.env` is required: Vite substitutes it
     * as literal text at build time, so a computed lookup yields undefined in
     * the production bundle.
     */
    basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
  },
);

/**
 * Publish the responsive scale ONCE, here, on `<html>`.
 *
 * It lives above the router rather than in each route because `base.css` applies
 * it to `html { font-size }` — a property no route component owns — and because
 * a route-level write would reset to 1 for a frame on every navigation, making
 * the whole UI visibly jump between screens on a tablet.
 */
function useGlobalUiScale(): void {
  const scale = useResponsiveScale();
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  }, [scale]);
}

export function App() {
  useGlobalUiScale();
  return <RouterProvider router={router} />;
}
