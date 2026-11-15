/**
 * The board: one SVG, drawn from the state alone.
 *
 * Tapping a thin line on a phone is hopeless, so every undrawn line owns a
 * diamond-shaped hit zone — its two dots plus the centres of the boxes on
 * either side. The diamonds tile the whole board, so a tap anywhere picks the
 * nearest line. A line is drawn on release (click), like a button, so a
 * finger that lands in the wrong place can slide off and cancel; while the
 * pointer is over a line it is previewed in faint ink.
 *
 * Layers, bottom to top: claimed boxes, the last line's halo, drawn lines,
 * the preview, dots, hit zones.
 */
import { useState } from 'react';
import { edgeEnds, isHorizontal, EMPTY, type GameState } from '@/engine';
import './board.css';

/** SVG units per box side, and the margin around the dots. */
const CELL = 100;
const PAD = 26;

const px = (i: number) => PAD + i * CELL;

export interface BoardProps {
  state: GameState;
  /** False while it is not this device's turn (or a move is in flight). */
  interactive: boolean;
  /** Seat whose ink the preview line uses. */
  previewSeat: number | null;
  onLine: (edge: number) => void;
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

export function Board({ state, interactive, previewSeat, onLine }: BoardProps) {
  const size = state.config;
  const [hover, setHover] = useState<number | null>(null);
  const width = PAD * 2 + size.cols * CELL;
  const height = PAD * 2 + size.rows * CELL;
  const last = state.lastMove.kind === 'line' || state.lastMove.kind === 'away' ? state.lastMove.edge : null;
  const shownHover = interactive && hover !== null && state.edges[hover] === EMPTY ? hover : null;

  const line = (e: number) => {
    const [[c1, r1], [c2, r2]] = edgeEnds(size, e);
    return { x1: px(c1), y1: px(r1), x2: px(c2), y2: px(r2) };
  };

  const diamond = (e: number) => {
    const { x1, y1, x2, y2 } = line(e);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const h = CELL / 2;
    return isHorizontal(size, e)
      ? `${x1},${y1} ${mx},${my - h} ${x2},${y2} ${mx},${my + h}`
      : `${x1},${y1} ${mx - h},${my} ${x2},${y2} ${mx + h},${my}`;
  };

  const describe = (e: number) => {
    const [[c1, r1], [c2, r2]] = edgeEnds(size, e);
    return `Line from row ${r1 + 1} column ${c1 + 1} to row ${r2 + 1} column ${c2 + 1}`;
  };

  const boxes = [];
  for (let b = 0; b < state.boxes.length; b++) {
    const mark = state.boxes[b];
    if (mark === EMPTY) continue;
    const seat = Number(mark);
    const x = px(b % size.cols);
    const y = px(Math.floor(b / size.cols));
    boxes.push(
      <g key={b} className="board__box" data-seat={seat}>
        <rect x={x + 6} y={y + 6} width={CELL - 12} height={CELL - 12} rx="8" />
        <text x={x + CELL / 2} y={y + CELL / 2} dy="0.36em" textAnchor="middle">
          {initialOf(state.players[seat]?.name ?? '?')}
        </text>
      </g>,
    );
  }

  const drawn = [];
  const free: number[] = [];
  for (let e = 0; e < state.edges.length; e++) {
    const mark = state.edges[e];
    if (mark === EMPTY) {
      free.push(e);
      continue;
    }
    drawn.push(
      // Keyed by game too, so a rematch replays the draw-in animation.
      <line
        key={`${state.gameNo}-${e}`}
        className={`board__line${e === last ? ' board__line--last' : ''}`}
        data-seat={mark}
        {...line(e)}
      />,
    );
  }

  return (
    <svg
      className="board"
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={`Board, ${size.cols} by ${size.rows} boxes`}
      onPointerLeave={() => setHover(null)}
    >
      <g>{boxes}</g>
      {last !== null && state.edges[last] !== EMPTY && (
        <line className="board__halo" data-seat={state.edges[last]} {...line(last)} />
      )}
      <g>{drawn}</g>
      {shownHover !== null && (
        <line className="board__preview" data-seat={previewSeat ?? undefined} {...line(shownHover)} />
      )}
      <g className="board__dots">
        {Array.from({ length: (size.rows + 1) * (size.cols + 1) }, (_, i) => (
          <circle key={i} cx={px(i % (size.cols + 1))} cy={px(Math.floor(i / (size.cols + 1)))} r="7.5" />
        ))}
      </g>
      {interactive && (
        <g className="board__hits">
          {free.map((e) => (
            <polygon
              key={e}
              points={diamond(e)}
              role="button"
              tabIndex={0}
              aria-label={describe(e)}
              onPointerEnter={() => setHover(e)}
              onPointerDown={() => setHover(e)}
              onFocus={() => setHover(e)}
              onBlur={() => setHover((h) => (h === e ? null : h))}
              onClick={() => {
                setHover(null);
                onLine(e);
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  setHover(null);
                  onLine(e);
                }
              }}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
