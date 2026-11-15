/**
 * The quilt: one SVG, drawn from the state alone.
 *
 * Paws go on the points where the stitched seams cross, like stones on a go
 * board. Every empty point owns a square hit zone the size of one patch, so
 * the zones tile the whole board and a tap anywhere picks the nearest point.
 *
 * Fingers are imprecise on a 15×15 quilt, so a touch only CHOOSES a point (a
 * faint paw appears there) and the game view's "Leave a paw here" button —
 * or a second tap on the same point — plays it. A mouse click plays at once.
 *
 * Layers, bottom to top: patches, seams, star buttons, the winning yarn,
 * paws, the last-move ring, the chosen point, hit zones.
 */
import { useRef, useState } from 'react';
import { colOf, rowOf, EMPTY, type GameState } from '@/engine';
import './board.css';

/** SVG units between two points, and the margin around the outermost seams. */
const CELL = 60;
const PAD = 36;

const px = (i: number) => PAD + i * CELL;

export interface BoardProps {
  state: GameState;
  /** False while it is not this device's turn (or a move is in flight). */
  interactive: boolean;
  /** Seat whose colour the chosen-point preview uses. */
  previewSeat: number | null;
  /** The point chosen but not yet played. */
  chosen: number | null;
  /** Points of the winning line, to wrap in yarn. */
  line: number[] | null;
  /** `now` is true for a mouse click or a second tap: play it, do not just choose it. */
  onPoint: (cell: number, now: boolean) => void;
}

/** Star points: the sewn-on buttons that help you count. Middle and the four 3-in corners. */
function starPoints(size: number): number[] {
  const mid = Math.floor(size / 2);
  const edge = size >= 13 ? 3 : 2;
  const far = size - 1 - edge;
  return [
    [mid, mid],
    [edge, edge],
    [edge, far],
    [far, edge],
    [far, far],
  ].map(([r, c]) => r * size + c);
}

/** A paw print centred on (0, 0), about 0.7 units across. */
function PawPrint() {
  return (
    <g className="paw__print">
      <path d="M0 -0.02c0.17 0 0.3 0.15 0.3 0.28c0 0.12-0.13 0.16-0.3 0.12c-0.17 0.04-0.3 0-0.3-0.12c0-0.13 0.13-0.28 0.3-0.28z" />
      <ellipse cx="-0.3" cy="-0.15" rx="0.085" ry="0.11" transform="rotate(-20 -0.3 -0.15)" />
      <ellipse cx="-0.11" cy="-0.32" rx="0.085" ry="0.115" transform="rotate(-6 -0.11 -0.32)" />
      <ellipse cx="0.11" cy="-0.32" rx="0.085" ry="0.115" transform="rotate(6 0.11 -0.32)" />
      <ellipse cx="0.3" cy="-0.15" rx="0.085" ry="0.11" transform="rotate(20 0.3 -0.15)" />
    </g>
  );
}

export function Paw({ seat, ghost = false }: { seat: number; ghost?: boolean }) {
  return (
    <g className={`paw${ghost ? ' paw--ghost' : ''}`} data-seat={seat}>
      <circle className="paw__disc" r="0.46" />
      <circle className="paw__ring" r="0.38" />
      <PawPrint />
    </g>
  );
}

function pointName(size: number, cell: number): string {
  return `Row ${rowOf(size, cell) + 1}, column ${colOf(size, cell) + 1}`;
}

export function Board({ state, interactive, previewSeat, chosen, line, onPoint }: BoardProps) {
  const size = state.config.size;
  const [hover, setHover] = useState<number | null>(null);
  // Safari's click event has no pointerType, so remember it from pointerdown.
  const pointerKind = useRef<string>('touch');
  const span = PAD * 2 + (size - 1) * CELL;
  const last = state.lastMove.kind === 'paw' || state.lastMove.kind === 'away' ? state.lastMove.cell : null;
  const winSet = new Set(line ?? []);

  const patches = [];
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      patches.push(
        <rect
          key={`${r}-${c}`}
          className={(r + c) % 2 ? 'board__patch board__patch--b' : 'board__patch'}
          x={px(c)}
          y={px(r)}
          width={CELL}
          height={CELL}
        />,
      );
    }
  }

  const seams = [];
  for (let i = 0; i < size; i++) {
    seams.push(<line key={`h${i}`} x1={px(0)} y1={px(i)} x2={px(size - 1)} y2={px(i)} />);
    seams.push(<line key={`v${i}`} x1={px(i)} y1={px(0)} x2={px(i)} y2={px(size - 1)} />);
  }

  const paws = [];
  const free: number[] = [];
  for (let cell = 0; cell < state.cells.length; cell++) {
    const mark = state.cells[cell];
    if (mark === EMPTY) {
      free.push(cell);
      continue;
    }
    paws.push(
      // Keyed by game too, so a rematch replays the step-in animation.
      <g
        key={`${state.gameNo}-${cell}`}
        className={`board__paw${winSet.has(cell) ? ' board__paw--win' : ''}${cell === last ? ' board__paw--last' : ''}`}
        transform={`translate(${px(colOf(size, cell))} ${px(rowOf(size, cell))}) scale(${CELL})`}
      >
        <Paw seat={Number(mark)} />
      </g>,
    );
  }

  const preview = interactive ? (chosen ?? hover) : null;
  const shownPreview = preview !== null && state.cells[preview] === EMPTY ? preview : null;

  const yarn =
    line && line.length > 1 ? (
      <line
        className="board__yarn"
        data-seat={state.cells[line[0]]}
        x1={px(colOf(size, line[0]))}
        y1={px(rowOf(size, line[0]))}
        x2={px(colOf(size, line[line.length - 1]))}
        y2={px(rowOf(size, line[line.length - 1]))}
      />
    ) : null;

  return (
    <svg
      className="board"
      viewBox={`0 0 ${span} ${span}`}
      role="group"
      aria-label={`Quilt, ${size} by ${size} points`}
      onPointerLeave={() => setHover(null)}
    >
      <rect className="board__edge" x={PAD / 3} y={PAD / 3} width={span - (PAD * 2) / 3} height={span - (PAD * 2) / 3} rx="14" />
      <g>{patches}</g>
      <g className="board__seams">{seams}</g>
      <g className="board__stars">
        {starPoints(size).map((cell) => (
          <circle key={cell} cx={px(colOf(size, cell))} cy={px(rowOf(size, cell))} r="6" />
        ))}
      </g>
      {yarn}
      <g>{paws}</g>
      {last !== null && state.cells[last] !== EMPTY && (
        <circle
          className="board__last"
          data-seat={state.cells[last]}
          cx={px(colOf(size, last))}
          cy={px(rowOf(size, last))}
          r={CELL * 0.52}
        />
      )}
      {shownPreview !== null && previewSeat !== null && (
        <g
          className={`board__preview${shownPreview === chosen ? ' board__preview--chosen' : ''}`}
          transform={`translate(${px(colOf(size, shownPreview))} ${px(rowOf(size, shownPreview))}) scale(${CELL})`}
        >
          <Paw seat={previewSeat} ghost />
        </g>
      )}
      {interactive && (
        <g className="board__hits">
          {free.map((cell) => (
            <rect
              key={cell}
              x={px(colOf(size, cell)) - CELL / 2}
              y={px(rowOf(size, cell)) - CELL / 2}
              width={CELL}
              height={CELL}
              role="button"
              tabIndex={0}
              aria-label={pointName(size, cell)}
              aria-pressed={cell === chosen}
              onPointerDown={(ev) => {
                pointerKind.current = ev.pointerType;
              }}
              onPointerEnter={(ev) => {
                if (ev.pointerType === 'mouse') setHover(cell);
              }}
              onFocus={() => setHover(cell)}
              onBlur={() => setHover((h) => (h === cell ? null : h))}
              onClick={(ev) => {
                // A keyboard "click" (detail 0) is handled by onKeyDown below.
                if (ev.detail === 0) return;
                const mouse = pointerKind.current === 'mouse';
                setHover(null);
                onPoint(cell, mouse || cell === chosen);
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  setHover(null);
                  onPoint(cell, true);
                }
              }}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
