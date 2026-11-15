/**
 * The playing screen, shared by the cats and online rooms: the scoreboard,
 * one line saying what is happening, your floor, the cats at the door, every
 * other player's floor, and — after twelve rounds — the result with
 * "Play again".
 *
 * Presentational: it knows nothing about stores or the network. The routes
 * pass in the state and the callbacks. What it does own is the cat you are
 * holding: which one, which way up, and where it is hovering over your floor.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  COATS,
  PTS,
  RULES,
  SHAPES,
  cellsAt,
  extent,
  fits,
  floorCats,
  gridOf,
  orient,
  parseMarket,
  placements,
  roundOf,
  tally,
  tileName,
  winners,
  type GameState,
  type Move,
  type Tally,
  type Tile,
} from '@/engine';
import { Avatar } from '@/components/avatar';
import { tileMarkup } from '@/components/draw';
import { Floor } from '@/components/floor';
import { HelpModal } from '@/components/help';
import './game-view.css';

export interface GameViewProps {
  state: GameState;
  /** This device's seat, or null for a spectator. */
  mySeat: number | null;
  /** A cat that is "thinking" (offline only). */
  thinkingSeat?: number | null;
  /** uids whose connection is gone (online only). */
  away?: ReadonlySet<string>;
  /** A move from this device is in flight. */
  busy?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  /** Shown in the header: the room code online. */
  tag?: string;
  onMove: (move: Extract<Move, { kind: 'seat' | 'pass' }>) => void;
  onRematch: () => void;
  onLeave: () => void;
  leaveLabel: string;
}

function nameFor(state: GameState, seat: number, mySeat: number | null): string {
  return seat === mySeat ? 'You' : (state.players[seat]?.name ?? 'Player');
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** What the last pick was, in words — so a pick you did not watch is not a mystery. */
function lastPickLine(state: GameState, mySeat: number | null): string {
  const last = state.lastMove;
  if (!last.tile || last.seat === mySeat) return '';
  const who = nameFor(state, last.seat, mySeat);
  const tile = { coat: last.tile[0] as Tile['coat'], shape: Number(last.tile[1]) };
  return last.cat ? `${who} took the ${tileName(tile)}. ` : `${who} sent the ${tileName(tile)} away. `;
}

function TileArt({ tile, orientation }: { tile: Tile; orientation: number }) {
  const art = useMemo(() => tileMarkup(orient(tile.shape, orientation), tile.coat), [tile.shape, tile.coat, orientation]);
  return <svg viewBox={art.viewBox} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: art.markup }} />;
}

export function GameView({
  state,
  mySeat,
  thinkingSeat = null,
  away,
  busy = false,
  error,
  onDismissError,
  tag,
  onMove,
  onRematch,
  onLeave,
  leaveLabel,
}: GameViewProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  // The cat in hand: market slot (-1 = none), orientation 0–7, and the
  // top-left square of where it hovers.
  const [held, setHeld] = useState({ slot: -1, orient: 0, x: 2, y: 2 });

  const over = state.phase === 'gameover';
  const myTurn = mySeat !== null && state.toAct === mySeat;
  const canAct = myTurn && !busy;
  // Spectators watch the first seat's floor.
  const viewSeat = mySeat ?? 0;
  const market = useMemo(() => parseMarket(state.market), [state.market]);
  const tallies: Tally[] = useMemo(
    () => state.players.map((_, seat) => tally(floorCats(state, seat))),
    // The floors are the only input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.floors],
  );
  const myCats = useMemo(() => floorCats(state, viewSeat), [state, viewSeat]);
  const myGrid = useMemo(() => gridOf(myCats), [myCats]);
  const top = over ? winners(state) : [];

  // A new state means the door has changed: put the cat down.
  useEffect(() => {
    setHeld((h) => (h.slot < 0 ? h : { ...h, slot: -1 }));
  }, [state.version]);

  const tile = canAct && held.slot >= 0 ? (market[held.slot] ?? null) : null;
  const ghost = useMemo(() => {
    if (!tile) return null;
    const cells = cellsAt(tile.shape, held.orient, held.x, held.y);
    return { cells, coat: tile.coat, ok: fits(myGrid, cells) };
  }, [tile, held.orient, held.x, held.y, myGrid]);
  const room = useMemo(() => market.map((t) => (t ? placements(myGrid, t).length > 0 : false)), [market, myGrid]);

  // ── Holding, turning and aiming ─────────────────────────────────────────
  const clamp = (shape: number, o: number, x: number, y: number) => {
    const [w, h] = extent(orient(shape, o));
    return { x: Math.max(0, Math.min(RULES.W - w, x)), y: Math.max(0, Math.min(RULES.H - h, y)) };
  };

  const select = useCallback(
    (slot: number) => {
      const t = market[slot];
      if (!canAct || !t) return;
      setHeld((h) => {
        // Start somewhere legal: the way up it arrived if that fits anywhere
        // (as near as possible to where the last cat was aimed), otherwise
        // the first orientation that does.
        for (let o = 0; o < 8; o++) {
          const at = clamp(t.shape, o, h.x, h.y);
          const [w, hh] = extent(orient(t.shape, o));
          let best: { x: number; y: number; d: number } | null = null;
          for (let gy = 0; gy + hh <= RULES.H; gy++) {
            for (let gx = 0; gx + w <= RULES.W; gx++) {
              if (!fits(myGrid, cellsAt(t.shape, o, gx, gy))) continue;
              const d = Math.abs(gx - at.x) + Math.abs(gy - at.y);
              if (!best || d < best.d) best = { x: gx, y: gy, d };
            }
          }
          if (best) return { slot, orient: o, x: best.x, y: best.y };
        }
        // No room anywhere: hold it where it was aimed, so it can be sent away.
        return { slot, orient: 0, ...clamp(t.shape, 0, h.x, h.y) };
      });
    },
    [canAct, market, myGrid],
  );

  const turn = useCallback(
    (quarter: number, flip: boolean) => {
      if (!tile) return;
      setHeld((h) => {
        const o = ((h.orient % 4) + quarter) % 4 + (h.orient >= 4 !== flip ? 4 : 0);
        return { ...h, orient: o, ...clamp(tile.shape, o, h.x, h.y) };
      });
    },
    [tile],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!tile) return;
      setHeld((h) => ({ ...h, ...clamp(tile.shape, h.orient, h.x + dx, h.y + dy) }));
    },
    [tile],
  );

  const floorRef = useRef<SVGSVGElement>(null);
  /** Put the ghost so the pointed-at square is roughly its middle. False if no cat is held. */
  const aim = useCallback(
    (clientX: number, clientY: number): boolean => {
      const svg = floorRef.current;
      if (!tile || !svg) return false;
      const r = svg.getBoundingClientRect();
      const cx = Math.floor(((clientX - r.left) / r.width) * RULES.W);
      const cy = Math.floor(((clientY - r.top) / r.height) * RULES.H);
      setHeld((h) => {
        const [w, hh] = extent(orient(tile.shape, h.orient));
        const next = clamp(tile.shape, h.orient, cx - Math.floor((w - 1) / 2), cy - Math.floor((hh - 1) / 2));
        return next.x === h.x && next.y === h.y ? h : { ...h, ...next };
      });
      return true;
    },
    [tile],
  );

  const place = useCallback(() => {
    if (ghost?.ok && held.slot >= 0) onMove({ kind: 'seat', slot: held.slot, orient: held.orient, x: held.x, y: held.y });
  }, [ghost, held, onMove]);
  const sendAway = useCallback(() => {
    if (tile) onMove({ kind: 'pass', slot: held.slot });
  }, [tile, held.slot, onMove]);

  // Market: tap to pick up, tap the held cat again to rotate, or drag it onto
  // the floor. `press` remembers what the press itself already did, so the
  // click that follows does not do it twice.
  const press = useRef<{ picked: boolean; dragged: boolean } | null>(null);
  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const svg = floorRef.current;
      if (!press.current || !svg) return;
      const r = svg.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        press.current.dragged = true;
        aim(e.clientX, e.clientY);
      }
    };
    const end = () => {
      if (press.current) setTimeout(() => (press.current = null), 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [aim]);

  // Floor: with a finger, tap or drag to aim and use the button to commit;
  // with a mouse, the ghost follows the pointer and a click seats the cat.
  const aiming = useRef(false);
  const onFloorDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!aim(e.clientX, e.clientY)) return;
    aiming.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onFloorMove = (e: PointerEvent<SVGSVGElement>) => {
    if (aiming.current || e.pointerType === 'mouse') aim(e.clientX, e.clientY);
  };
  const onFloorUp = (e: PointerEvent<SVGSVGElement>) => {
    const was = aiming.current;
    aiming.current = false;
    if (was && e.pointerType === 'mouse' && e.button === 0) place();
  };

  useEffect(() => {
    if (!canAct || helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= String(market.length)) select(Number(k) - 1);
      else if (k === 'r') turn(1, false);
      else if (k === 'f') turn(0, true);
      else if (k === 'enter' && !target?.closest('button, a, summary')) place();
      else if (k.startsWith('arrow') && tile) {
        e.preventDefault();
        nudge(k === 'arrowleft' ? -1 : k === 'arrowright' ? 1 : 0, k === 'arrowup' ? -1 : k === 'arrowdown' ? 1 : 0);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canAct, helpOpen, market.length, select, turn, place, nudge, tile]);

  // ── What to say ─────────────────────────────────────────────────────────
  let status: React.ReactNode;
  if (over) {
    if (top.length > 1) status = `A tie between ${joinNames(top.map((s) => nameFor(state, s, mySeat)))}!`;
    else status = top[0] === mySeat ? 'You win!' : `${nameFor(state, top[0], mySeat)} wins`;
  } else if (state.toAct !== null && !myTurn) {
    const name = nameFor(state, state.toAct, mySeat);
    const waiting = state.players[state.toAct].sitOut
      ? `${name} is away — the game will pick for them`
      : thinkingSeat === state.toAct
        ? `${name} is choosing…`
        : `${name}’s pick`;
    status = `${lastPickLine(state, mySeat)}${waiting}`;
  } else if (!tile || !ghost) {
    status = (
      <>
        {lastPickLine(state, mySeat)}
        <strong>Your pick.</strong> Choose a cat, then a spot on your floor.
      </>
    );
  } else if (!room[held.slot]) {
    status = (
      <>
        <span className="play__down">No room anywhere</span> for the {tileName(tile)}. Pick another cat, or send this one
        away.
      </>
    );
  } else if (!ghost.ok) {
    status = (
      <>
        <span className="play__down">Doesn’t fit there.</span> Try another spot, or rotate.
      </>
    );
  } else {
    const a = tallies[viewSeat];
    const b = tally([...myCats, { coat: ghost.coat, cells: ghost.cells }]);
    const bits: React.ReactNode[] = [];
    if (b.friends > a.friends) {
      bits.push(
        <span key="f">
          <span className="play__up">+{(b.friends - a.friends) * PTS.friend}</span> matching coats
        </span>,
      );
    }
    if (b.spats > a.spats) {
      bits.push(
        <span key="s">
          <span className="play__down">−{(b.spats - a.spats) * PTS.spat}</span> rivals touching
        </span>,
      );
    }
    if (b.rows > a.rows) {
      bits.push(
        <span key="r">
          <span className="play__up">+{(b.rows - a.rows) * PTS.row}</span> {b.rows - a.rows > 1 ? 'rows' : 'row'} filled
        </span>,
      );
    }
    status = bits.length ? (
      <>
        {bits.flatMap((bit, i) => (i ? [' · ', bit] : [bit]))} — <strong>{signed(b.total - a.total)} here</strong>
      </>
    ) : (
      <>
        No points here yet — <strong>{tileName(tile)}</strong>, {ghost.cells.length} squares.
      </>
    );
  }

  // The cat that just arrived on each floor animates in.
  const last = state.lastMove;
  const freshFor = (seat: number): number => (last.cat && last.seat === seat ? floorCats(state, seat).length - 1 : -1);
  const others = state.players.map((_, seat) => seat).filter((seat) => seat !== viewSeat);

  return (
    <main className="play">
      <header className="play__bar">
        <button type="button" className="btn btn--ghost btn--small" onClick={onLeave}>
          {leaveLabel}
        </button>
        <span className="play__tag">
          {tag && (
            <>
              Room <strong className="code-text selectable">{tag}</strong> ·{' '}
            </>
          )}
          {over ? 'Closing time' : `Round ${roundOf(state)} of ${RULES.ROUNDS}`}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--small play__help"
          onClick={() => setHelpOpen(true)}
          aria-label="How to play"
        >
          ?
        </button>
      </header>

      <ol className="play__scores" aria-label="Scores">
        {state.players.map((p, seat) => {
          const gone = away?.has(p.uid) ?? false;
          return (
            <li
              key={p.uid}
              className="score"
              data-seat={seat}
              data-turn={state.toAct === seat ? 'true' : 'false'}
              data-winner={top.includes(seat) ? 'true' : 'false'}
              data-thinking={thinkingSeat === seat ? 'true' : 'false'}
            >
              <span className="score__avatar">
                <Avatar uid={p.uid} name={p.name} />
              </span>
              <span className="score__name">
                {nameFor(state, seat, mySeat)}
                {gone && <span className="score__away">away</span>}
              </span>
              <span className="score__points" aria-label={`${tallies[seat].total} points`}>
                {tallies[seat].total}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="play__table">
        <section className="play__mine">
          <div className="play__floor" data-myturn={myTurn ? 'true' : 'false'}>
            <Floor
              svgRef={floorRef}
              floor={state.floors[viewSeat] ?? ''}
              label={`${mySeat === null ? `${nameFor(state, viewSeat, mySeat)}’s` : 'Your'} café floor, ${tallies[viewSeat].total} points`}
              fresh={freshFor(viewSeat)}
              ghost={ghost}
              arming={tile !== null}
              onPointerDown={onFloorDown}
              onPointerMove={onFloorMove}
              onPointerUp={onFloorUp}
              onPointerCancel={() => (aiming.current = false)}
            />
          </div>
          <p className="play__status" role="status">
            {status}
          </p>
        </section>

        <div className="play__side">
          {!over && (
            <section className="panel play__door" aria-label="Cats at the door">
              <div
                className="market"
                style={{ '--slots': market.length } as React.CSSProperties}
                onPointerDown={(e) => {
                  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-slot]');
                  if (!b || !canAct) return;
                  const slot = Number(b.dataset.slot);
                  press.current = { picked: slot !== held.slot, dragged: false };
                  if (press.current.picked) select(slot);
                }}
              >
                {market.map((t, slot) =>
                  t ? (
                    <button
                      key={slot}
                      type="button"
                      className="market__tile"
                      data-slot={slot}
                      data-room={room[slot] || !myTurn ? 'true' : 'false'}
                      aria-pressed={tile !== null && slot === held.slot}
                      aria-label={`${tileName(t)}, ${SHAPES[t.shape].cells.length} squares${
                        myTurn && !room[slot] ? ', no room on your floor' : ''
                      }${tile !== null && slot === held.slot ? ', selected — press again to rotate' : ''}`}
                      disabled={!canAct}
                      onClick={() => {
                        // The press itself already picked it up or dragged it.
                        if (press.current && (press.current.picked || press.current.dragged)) return;
                        if (tile !== null && slot === held.slot) turn(1, false);
                        else select(slot);
                      }}
                    >
                      <TileArt tile={t} orientation={tile !== null && slot === held.slot ? held.orient : 0} />
                      <span>{myTurn && !room[slot] ? 'no room' : `${COATS[t.coat].name} · ${SHAPES[t.shape].cells.length}`}</span>
                    </button>
                  ) : (
                    <div key={slot} className="market__tile market__tile--gone">
                      taken
                    </div>
                  ),
                )}
              </div>
              {mySeat !== null && (
                <div className="play__controls">
                  <button type="button" className="btn btn--secondary" disabled={!tile} onClick={() => turn(1, false)}>
                    Rotate
                  </button>
                  <button type="button" className="btn btn--secondary" disabled={!tile} onClick={() => turn(0, true)}>
                    Flip
                  </button>
                  <button type="button" className="btn btn--primary play__seat" disabled={!ghost?.ok} onClick={place}>
                    Seat this cat
                  </button>
                  <button type="button" className="btn btn--ghost btn--small play__pass" disabled={!tile} onClick={sendAway}>
                    Send it away instead (no points)
                  </button>
                </div>
              )}
            </section>
          )}

          {error && (
            <div className="notice notice--bad play__error">
              <p>{error}</p>
              {onDismissError && (
                <div className="notice__actions">
                  <button type="button" className="btn btn--ghost btn--small" onClick={onDismissError}>
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}

          {over && (
            <section className="panel play__over">
              <table className="play__sheet">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="visually-hidden">Player</span>
                    </th>
                    <th scope="col">Pairs</th>
                    <th scope="col">Spats</th>
                    <th scope="col">Rows</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {state.players
                    .map((_, seat) => seat)
                    .sort((a, b) => tallies[b].total - tallies[a].total || a - b)
                    .map((seat) => {
                      const t = tallies[seat];
                      return (
                        <tr key={seat} data-seat={seat} data-winner={top.includes(seat) ? 'true' : 'false'}>
                          <th scope="row">{nameFor(state, seat, mySeat)}</th>
                          <td>
                            {t.friends} <small>({signed(t.friends * PTS.friend)})</small>
                          </td>
                          <td>
                            {t.spats} <small>({signed(-t.spats * PTS.spat)})</small>
                          </td>
                          <td>
                            {t.rows} <small>({signed(t.rows * PTS.row)})</small>
                          </td>
                          <td className="play__total">{t.total}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {mySeat !== null && (
                <div className="stack">
                  <button type="button" className="btn btn--primary btn--block" onClick={onRematch} disabled={busy}>
                    Play again
                  </button>
                  <p className="field__hint play__hint">The next player along picks first.</p>
                </div>
              )}
            </section>
          )}

          <section className="play__others" data-count={others.length} aria-label="The other cafés">
            {others.map((seat) => (
              <figure key={seat} className="other" data-seat={seat} data-turn={state.toAct === seat ? 'true' : 'false'}>
                <figcaption>
                  <span className="other__name">{nameFor(state, seat, mySeat)}’s café</span>
                  <span className="other__parts">
                    {plural(tallies[seat].friends, 'pair')} · {plural(tallies[seat].spats, 'spat')} ·{' '}
                    {plural(tallies[seat].rows, 'row')}
                  </span>
                </figcaption>
                <Floor
                  mini
                  floor={state.floors[seat] ?? ''}
                  label={`${nameFor(state, seat, mySeat)}’s café floor, ${tallies[seat].total} points`}
                  fresh={freshFor(seat)}
                />
              </figure>
            ))}
          </section>

          <p className="play__legend">
            <strong>+{PTS.friend}</strong> same coats touching · <strong>−{PTS.spat}</strong> rivals touching (Ginger and
            Smoke, Tuxedo and Snow) · <strong>+{PTS.row}</strong> full row
          </p>
        </div>
      </div>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
