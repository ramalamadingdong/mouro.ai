/**
 * The playing screen, shared by the cats and online rooms: the other three
 * seats across the top of the felt, the tile on offer, your discards, melds
 * and hand at the bottom, and — between hands — the scoring.
 *
 * Presentational: it knows nothing about stores or the network. The routes
 * pass in the state and one `onMove` callback.
 */
import { useMemo, useState } from 'react';
import { CATS, CAT_UID_PREFIX } from '@/ai';
import {
  WIND_NAMES,
  chowTiles,
  claimOptions,
  kongOptions,
  parseLines,
  parseMelds,
  pointsFor,
  removeTiles,
  seatWind,
  selfWin,
  sortTiles,
  tileName,
  waits,
  type ChowPos,
  type GameState,
  type Move,
  type Player,
} from '@/engine';
import { Avatar } from '@/components/avatar';
import { HelpModal } from '@/components/help';
import { Tile, TileRow } from '@/components/tile';
import './game-view.css';

export interface GameViewProps {
  state: GameState;
  /** This device's seat, or null for a spectator. */
  mySeat: number | null;
  /** A cat that is "thinking". */
  thinkingSeat?: number | null;
  /** uids whose connection is gone (online only). */
  away?: ReadonlySet<string>;
  /** A move from this device is in flight. */
  busy?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  /** Shown in the header: the room code online. */
  tag?: string;
  /** A move for `mySeat` (discard, kong, win, claim). */
  onMove: (move: Move) => void;
  /** Deal the next hand, or start again after the last one. */
  onNext: () => void;
  onLeave: () => void;
  leaveLabel: string;
}

const WIND_LETTERS = ['E', 'S', 'W', 'N'];

function nameFor(state: GameState, seat: number, mySeat: number | null): string {
  return seat === mySeat ? 'You' : (state.players[seat]?.name ?? 'Player');
}

/** Cats online all carry the host's uid; draw their faces from their names. */
function avatarUid(p: Player): string {
  if (p.isHuman) return p.uid;
  if (p.uid.startsWith(CAT_UID_PREFIX)) return p.uid;
  return `${CAT_UID_PREFIX}${CATS.find((c) => c.name === p.name)?.id ?? 'tiger'}`;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function statusLine(state: GameState, mySeat: number | null, thinkingSeat: number | null): string {
  const name = (seat: number) => nameFor(state, seat, mySeat);
  const last = state.lastMove;
  const tile = last.tile ? tileName(last.tile) : '';

  if (state.phase === 'scored' || state.phase === 'gameover') {
    const r = state.result;
    if (!r || r.winner === -1) return 'The wall ran out — a drawn hand.';
    const how = r.from === -1 ? 'self-drawn' : `on ${r.from === mySeat ? 'your' : `${name(r.from)}’s`} discard`;
    return r.winner === mySeat ? `Mahjong! You win ${how}.` : `${name(r.winner)} went Mahjong, ${how}.`;
  }

  if (state.phase === 'claim' && state.claim) {
    const c = state.claim;
    if (c.asks[mySeat ?? -1] === '?') {
      return c.rob
        ? `${name(c.from)} is adding ${tileName(c.tile)} to a kong. Rob it?`
        : `${name(c.from)} threw ${tileName(c.tile)}. Call it?`;
    }
    const waiting = c.asks
      .split('')
      .flatMap((m, seat) => (m === '?' ? [seat] : []))
      .map((seat) => (state.players[seat].sitOut ? `${name(seat)} (away)` : name(seat)));
    return `Waiting for ${waiting.join(' and ')}…`;
  }

  const seat = state.toAct ?? 0;
  let before = '';
  if (last.event === 'pung' || last.event === 'chow' || last.event === 'kong') {
    before = `${name(last.eventSeat)} ${last.eventSeat === mySeat ? 'call' : 'calls'} ${last.event}${tile ? ` on ${tile}` : ''}. `;
  }
  if (seat === mySeat) {
    return `${before}${state.via === 'claim' ? 'Throw a tile.' : 'Your turn — tap a tile, then tap it again to throw it.'}`;
  }
  if (thinkingSeat === seat) return `${before}${name(seat)} is thinking…`;
  if (state.players[seat].sitOut) return `${before}${name(seat)} is away — the table will play for them.`;
  return `${before}${name(seat)}’s turn.`;
}

// ─── pieces ──────────────────────────────────────────────────────────────────

function Melds({ player, size }: { player: Player; size: 'xs' | 'sm' }) {
  const melds = parseMelds(player.melds);
  if (melds.length === 0 && !player.flowers) return null;
  return (
    <span className="melds">
      {melds.map((m, i) => (
        <span key={i} className="melds__meld" title={m.type === 'hidden-kong' ? 'Concealed kong' : m.type}>
          {m.type === 'hidden-kong' ? (
            <>
              <Tile tile="" size={size} />
              <Tile tile={m.tiles[0]} size={size} />
              <Tile tile={m.tiles[0]} size={size} />
              <Tile tile="" size={size} />
            </>
          ) : (
            <TileRow tiles={m.tiles} size={size} />
          )}
        </span>
      ))}
      {player.flowers && (
        <span className="melds__flowers" aria-label="Flowers and seasons">
          <TileRow tiles={player.flowers} size="xs" />
        </span>
      )}
    </span>
  );
}

function Discards({ tiles, highlightLast }: { tiles: string; highlightLast: boolean }) {
  return (
    <div className="discards" aria-label="Discards">
      {Array.from(tiles).map((t, i) => (
        <Tile key={i} tile={t} size="xs" highlight={highlightLast && i === tiles.length - 1} />
      ))}
    </div>
  );
}

interface SeatHeaderProps {
  state: GameState;
  seat: number;
  mySeat: number | null;
  away: boolean;
  thinking: boolean;
}

function SeatHeader({ state, seat, mySeat, away, thinking }: SeatHeaderProps) {
  const p = state.players[seat];
  const wind = seatWind(state, seat);
  return (
    <div className="seat__head">
      <span className="seat__avatar" data-thinking={thinking ? 'true' : 'false'}>
        <Avatar uid={avatarUid(p)} name={p.name} />
      </span>
      <span className="seat__name">
        {nameFor(state, seat, mySeat)}
        {away && <span className="seat__away">away</span>}
      </span>
      <span className="seat__wind" data-wind={wind} title={`${WIND_NAMES[wind]} seat${wind === 0 ? ' — the dealer' : ''}`}>
        {WIND_LETTERS[wind]}
        {wind === 0 && <span className="seat__dealer">dealer</span>}
      </span>
      <span className="seat__score" aria-label={`${p.score} points`}>
        {p.score}
      </span>
    </div>
  );
}

function OtherSeat(props: SeatHeaderProps & { offerSeat: number | null }) {
  const { state, seat } = props;
  const p = state.players[seat];
  const reveal = state.phase === 'scored' || state.phase === 'gameover';
  const onTurn = state.phase === 'turn' && state.toAct === seat;
  return (
    <section className="seat" data-turn={onTurn ? 'true' : 'false'} aria-label={nameFor(state, seat, props.mySeat)}>
      <SeatHeader {...props} />
      <div className="seat__tiles">
        <span className="seat__hand" aria-label={reveal ? 'Hand' : `${p.hand.length} tiles`}>
          {reveal ? (
            <TileRow tiles={p.hand} size="xs" />
          ) : (
            <span className="tile-row">
              {Array.from({ length: p.hand.length }, (_, i) => (
                <Tile key={i} tile="" size="xs" />
              ))}
            </span>
          )}
        </span>
        <Melds player={p} size="xs" />
      </div>
      <Discards tiles={p.discards} highlightLast={props.offerSeat === seat} />
    </section>
  );
}

// ─── the claim and turn controls ─────────────────────────────────────────────

const CHOW_LABEL: Record<ChowPos, string> = { l: 'low', m: 'middle', h: 'high' };

function ClaimBar({ state, mySeat, busy, onMove }: { state: GameState; mySeat: number; busy: boolean; onMove: (m: Move) => void }) {
  const claim = state.claim;
  if (!claim) return null;
  const options = claimOptions(state, mySeat, claim);
  const hand = state.players[mySeat].hand;
  return (
    <div className="claim" role="group" aria-label="Call the tile">
      <span className="claim__tile">
        <Tile tile={claim.tile} size="lg" highlight />
      </span>
      <div className="claim__buttons">
        {options.includes('w') && (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onMove({ kind: 'claim', seat: mySeat, call: 'win' })}>
            Mahjong!
          </button>
        )}
        {options.includes('k') && (
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => onMove({ kind: 'claim', seat: mySeat, call: 'kong' })}>
            Kong
          </button>
        )}
        {options.includes('p') && (
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => onMove({ kind: 'claim', seat: mySeat, call: 'pung' })}>
            Pung
          </button>
        )}
        {(['l', 'm', 'h'] as ChowPos[])
          .filter((pos) => options.includes(pos))
          .map((pos) => {
            const pair = chowTiles(hand, claim.tile, pos) ?? '';
            const run = sortTiles(pair + claim.tile);
            return (
              <button
                key={pos}
                type="button"
                className="btn btn--secondary claim__chow"
                disabled={busy}
                aria-label={`Chow, ${CHOW_LABEL[pos]}`}
                onClick={() => onMove({ kind: 'claim', seat: mySeat, call: 'chow', chow: pos })}
              >
                Chow <TileRow tiles={run} size="xs" />
              </button>
            );
          })}
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onMove({ kind: 'claim', seat: mySeat, call: 'pass' })}>
          Pass
        </button>
      </div>
    </div>
  );
}

function MyHand({
  state,
  mySeat,
  busy,
  onMove,
}: {
  state: GameState;
  mySeat: number;
  busy: boolean;
  onMove: (m: Move) => void;
}) {
  const p = state.players[mySeat];
  const myTurn = state.phase === 'turn' && state.toAct === mySeat;
  // A selection belongs to one state: any move (anyone's) clears it.
  const [pick, setPick] = useState<{ version: number; index: number } | null>(null);
  const selected = pick && pick.version === state.version ? pick.index : null;
  const setSelected = (index: number | null) => setPick(index === null ? null : { version: state.version, index });

  // The drawn tile sits apart, at the right end, as it does at a real table.
  const tiles = useMemo(() => {
    const list = Array.from(p.hand);
    if (myTurn && state.drawn) {
      const i = list.lastIndexOf(state.drawn);
      if (i >= 0) {
        list.splice(i, 1);
        return { list, drawn: state.drawn };
      }
    }
    return { list, drawn: '' };
  }, [p.hand, myTurn, state.drawn]);
  const all = tiles.drawn ? [...tiles.list, tiles.drawn] : tiles.list;

  const win = myTurn ? selfWin(state) : null;
  const kongs = myTurn ? kongOptions(state) : [];
  const selTile = selected !== null ? all[selected] : null;

  // "Waiting on": for a 13-tile hand as it stands, or for the hand left after throwing the selected tile.
  const waitingOn = useMemo(() => {
    if (!myTurn) return waits(p.hand);
    if (selTile) return waits(removeTiles(p.hand, selTile) ?? '');
    return [];
  }, [myTurn, p.hand, selTile]);

  function tap(i: number): void {
    if (!myTurn || busy) return;
    if (selected === i) {
      onMove({ kind: 'discard', seat: mySeat, tile: all[i] });
      setSelected(null);
    } else setSelected(i);
  }

  return (
    <div className="me__hand-wrap">
      <div className="me__hand" data-myturn={myTurn ? 'true' : 'false'} role="group" aria-label="Your hand">
        {all.map((t, i) => (
          <button
            key={`${i}-${t}`}
            type="button"
            className="me__tile"
            data-selected={selected === i ? 'true' : 'false'}
            data-drawn={tiles.drawn && i === all.length - 1 ? 'true' : 'false'}
            disabled={!myTurn || busy}
            aria-pressed={selected === i}
            aria-label={`${tileName(t)}${selected === i ? ', selected — tap again to throw' : ''}`}
            onClick={() => tap(i)}
          >
            <Tile tile={t} size="lg" />
          </button>
        ))}
      </div>

      {myTurn && (
        <div className="me__actions">
          {win && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => onMove({ kind: 'win', seat: mySeat })}>
              Mahjong! ({win.faan} faan)
            </button>
          )}
          {kongs.map((t) => (
            <button key={t} type="button" className="btn btn--secondary me__kong" disabled={busy} onClick={() => onMove({ kind: 'kong', seat: mySeat, tile: t })}>
              Kong <Tile tile={t} size="xs" />
            </button>
          ))}
          <button
            type="button"
            className={selTile ? 'btn btn--primary' : 'btn btn--secondary'}
            disabled={busy || !selTile}
            onClick={() => selTile && onMove({ kind: 'discard', seat: mySeat, tile: selTile })}
          >
            {selTile ? `Throw ${tileName(selTile)}` : 'Pick a tile to throw'}
          </button>
        </div>
      )}

      {waitingOn.length > 0 && (
        <p className="me__waits">
          {myTurn ? 'Throw it and you are ready, waiting on' : 'Ready! Waiting on'} <TileRow tiles={waitingOn.join('')} size="xs" />
        </p>
      )}
    </div>
  );
}

// ─── between hands ───────────────────────────────────────────────────────────

function ResultPanel({
  state,
  mySeat,
  busy,
  onNext,
}: {
  state: GameState;
  mySeat: number | null;
  busy: boolean;
  onNext: () => void;
}) {
  const r = state.result;
  if (!r) return null;
  const pay = r.pay.split(',').map(Number);
  const over = state.phase === 'gameover';
  const winner = r.winner >= 0 ? state.players[r.winner] : null;
  const lines = parseLines(r.lines);
  const ranking = state.players.map((p, seat) => ({ p, seat })).sort((a, b) => b.p.score - a.p.score || a.seat - b.seat);
  return (
    <section className="panel result" aria-label="Scoring">
      {winner && (
        <>
          <div className="result__hand">
            <TileRow tiles={winner.hand} size="sm" />
            <Melds player={winner} size="sm" />
          </div>
          <ul className="result__lines">
            {lines.map(([name, faan], i) => (
              <li key={i}>
                <span>{name}</span>
                <strong>{faan}</strong>
              </li>
            ))}
            <li className="result__total">
              <span>
                {r.faan} faan → {pointsFor(r.faan)} points
              </span>
            </li>
          </ul>
        </>
      )}
      <ol className="result__pay">
        {(over ? ranking : state.players.map((p, seat) => ({ p, seat }))).map(({ p, seat }) => (
          <li key={seat}>
            <span>{nameFor(state, seat, mySeat)}</span>
            <span className="result__delta" data-sign={Math.sign(pay[seat])}>
              {pay[seat] !== 0 ? signed(pay[seat]) : '—'}
            </span>
            <strong>{p.score}</strong>
          </li>
        ))}
      </ol>
      {over ? (
        <p className="result__over">
          {ranking[0].seat === mySeat ? 'You finish on top!' : `${nameFor(state, ranking[0].seat, mySeat)} finishes on top.`}
        </p>
      ) : (
        <p className="field__hint">
          {r.winner === -1 || r.winner === state.dealer ? 'The dealer stays for another hand.' : 'The deal passes to the next seat.'}
        </p>
      )}
      <button type="button" className="btn btn--primary btn--block" onClick={onNext} disabled={busy}>
        {over ? 'Play again' : 'Next hand'}
      </button>
    </section>
  );
}

// ─── the screen ──────────────────────────────────────────────────────────────

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
  onNext,
  onLeave,
  leaveLabel,
}: GameViewProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const view = mySeat ?? 0;
  const others = [1, 2, 3].map((d) => (view + d) % 4);
  const between = state.phase === 'scored' || state.phase === 'gameover';
  // Whose discard pile holds the tile on offer (or the last one thrown).
  const offerSeat = state.phase === 'claim' && state.claim && !state.claim.rob ? state.claim.from : null;
  const asked = mySeat !== null && state.phase === 'claim' && state.claim?.asks[mySeat] === '?';
  const me = mySeat !== null ? state.players[mySeat] : null;
  const roundName = `${WIND_NAMES[state.wind]} round`;

  return (
    <main className="play">
      <header className="play__bar">
        <button type="button" className="btn btn--ghost btn--small" onClick={onLeave}>
          {leaveLabel}
        </button>
        <span className="play__tag">
          {roundName} · hand {state.handNo}
          {!between && ` · ${state.wall.length} left`}
          {tag && (
            <>
              {' '}
              · <strong className="code-text selectable">{tag}</strong>
            </>
          )}
        </span>
        <button type="button" className="btn btn--ghost btn--small play__help" onClick={() => setHelpOpen(true)} aria-label="How to play">
          ?
        </button>
      </header>

      <div className="table">
        {others.map((seat) => (
          <OtherSeat
            key={seat}
            state={state}
            seat={seat}
            mySeat={mySeat}
            away={away?.has(state.players[seat].uid) ?? false}
            thinking={thinkingSeat === seat}
            offerSeat={offerSeat}
          />
        ))}

        {me && mySeat !== null && (
          <section className="seat seat--me" data-turn={state.phase === 'turn' && state.toAct === mySeat ? 'true' : 'false'}>
            <SeatHeader state={state} seat={mySeat} mySeat={mySeat} away={false} thinking={false} />
            <Discards tiles={me.discards} highlightLast={offerSeat === mySeat} />
            <Melds player={me} size="sm" />
          </section>
        )}
      </div>

      <p className="play__status" role="status">
        {statusLine(state, mySeat, thinkingSeat)}
      </p>

      {asked && mySeat !== null && <ClaimBar state={state} mySeat={mySeat} busy={busy} onMove={onMove} />}

      {me && mySeat !== null && <MyHand state={state} mySeat={mySeat} busy={busy} onMove={onMove} />}

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

      {between && <ResultPanel state={state} mySeat={mySeat} busy={busy} onNext={onNext} />}

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
