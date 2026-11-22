/**
 * One mahjong tile, drawn as inline SVG: dots and bamboo are shapes, the
 * characters, winds, dragons and bonus tiles are the traditional Chinese
 * characters with a small Latin index in the corner (1–9, E S W N, R G W,
 * flower and season numbers) so a newcomer can read every tile.
 *
 * Purely presentational; `Tile` is a <span>, wrap it in a button to make it
 * tappable.
 */
import { memo } from 'react';
import { kindOf, rankOf, suitOf, tileName } from '@/engine';
import { HAS_CJK } from '@/util/cjk';
import './tile.css';

const RED = 'var(--tile-red)';
const GREEN = 'var(--tile-green)';
const BLUE = 'var(--tile-blue)';
const INK = 'var(--tile-ink)';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WINDS = ['東', '南', '西', '北'];
const FLOWERS = ['梅', '蘭', '菊', '竹'];
const SEASONS = ['春', '夏', '秋', '冬'];

type Dot = [x: number, y: number, color: string];

const DOTS: Record<number, Dot[]> = {
  2: [[15, 11, GREEN], [15, 29, BLUE]],
  3: [[8, 9, BLUE], [15, 20, RED], [22, 31, GREEN]],
  4: [[9, 11, BLUE], [21, 11, GREEN], [9, 29, GREEN], [21, 29, BLUE]],
  5: [[8.5, 9.5, BLUE], [21.5, 9.5, GREEN], [15, 20, RED], [8.5, 30.5, GREEN], [21.5, 30.5, BLUE]],
  6: [[9.5, 8.5, GREEN], [20.5, 8.5, GREEN], [9.5, 20, RED], [20.5, 20, RED], [9.5, 31.5, RED], [20.5, 31.5, RED]],
  7: [[7, 6.5, GREEN], [15, 10, GREEN], [23, 13.5, GREEN], [10, 23, RED], [20, 23, RED], [10, 32.5, RED], [20, 32.5, RED]],
  8: [[10, 6.5, BLUE], [20, 6.5, BLUE], [10, 15.5, BLUE], [20, 15.5, BLUE], [10, 24.5, BLUE], [20, 24.5, BLUE], [10, 33.5, BLUE], [20, 33.5, BLUE]],
  9: [[7.5, 8.5, BLUE], [15, 8.5, BLUE], [22.5, 8.5, BLUE], [7.5, 20, RED], [15, 20, RED], [22.5, 20, RED], [7.5, 31.5, GREEN], [15, 31.5, GREEN], [22.5, 31.5, GREEN]],
};
const DOT_R: Record<number, number> = { 2: 5.6, 3: 4.6, 4: 4.6, 5: 4.2, 6: 4, 7: 3.4, 8: 3.3, 9: 3.3 };

type Stick = [x: number, y: number, color: string];

/** Bamboo sticks: top-left corner of each 3.4 × 10 stick. */
const STICKS: Record<number, Stick[]> = {
  2: [[13.3, 6, BLUE], [13.3, 24, GREEN]],
  3: [[13.3, 6, BLUE], [7.5, 24, GREEN], [19, 24, GREEN]],
  4: [[8, 6, BLUE], [18.6, 6, GREEN], [8, 24, GREEN], [18.6, 24, BLUE]],
  5: [[6, 6, GREEN], [20.6, 6, BLUE], [13.3, 15, RED], [6, 24, BLUE], [20.6, 24, GREEN]],
  6: [[6, 6, GREEN], [13.3, 6, GREEN], [20.6, 6, GREEN], [6, 24, BLUE], [13.3, 24, BLUE], [20.6, 24, BLUE]],
  7: [[13.3, 3, RED], [6, 15, GREEN], [13.3, 15, BLUE], [20.6, 15, GREEN], [6, 27, GREEN], [13.3, 27, BLUE], [20.6, 27, GREEN]],
  8: [[4, 6, GREEN], [10.3, 6, GREEN], [16.3, 6, GREEN], [22.6, 6, GREEN], [4, 24, BLUE], [10.3, 24, BLUE], [16.3, 24, BLUE], [22.6, 24, BLUE]],
  9: [[6, 3, RED], [13.3, 3, BLUE], [20.6, 3, GREEN], [6, 15, RED], [13.3, 15, BLUE], [20.6, 15, GREEN], [6, 27, RED], [13.3, 27, BLUE], [20.6, 27, GREEN]],
};

function Corner({ text, color = INK }: { text: string; color?: string }) {
  return (
    <text x="2.2" y="7" className="tile__index" fill={color}>
      {text}
    </text>
  );
}

/** Latin stand-in for a tile character when the device has no Chinese font (see util/cjk.ts). */
function Fallback({ text, y, size, color }: { text: string; y: number; size: number; color: string }) {
  return (
    <text x="15" y={y} textAnchor="middle" className="tile__fallback" fontSize={size} fill={color}>
      {text}
    </text>
  );
}

function Glyph({ ch, y, size, color }: { ch: string; y: number; size: number; color: string }) {
  return (
    <text x="15" y={y} textAnchor="middle" className="tile__glyph" fontSize={size} fill={color}>
      {ch}
    </text>
  );
}

function Face({ tile }: { tile: string }) {
  const kind = kindOf(tile);
  const suit = suitOf(kind);
  const rank = rankOf(kind);
  switch (suit) {
    case 'characters':
      return (
        HAS_CJK ? (
          <>
            <Glyph ch={NUMERALS[rank - 1]} y={18} size={13} color={INK} />
            <Glyph ch="萬" y={35} size={14} color={RED} />
            <Corner text={String(rank)} />
          </>
        ) : (
          <>
            <Fallback text={String(rank)} y={23} size={19} color={INK} />
            <Fallback text="WAN" y={34} size={7.5} color={RED} />
          </>
        )
      );
    case 'dots':
      if (rank === 1) {
        return (
          <>
            <circle cx="15" cy="20" r="10.5" fill="none" stroke={GREEN} strokeWidth="2" />
            <circle cx="15" cy="20" r="7" fill={BLUE} />
            <circle cx="15" cy="20" r="3.2" fill={RED} />
            <Corner text="1" />
          </>
        );
      }
      return (
        <>
          {DOTS[rank].map(([x, y, c], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={DOT_R[rank]} fill={c} />
              <circle cx={x} cy={y} r={DOT_R[rank] * 0.42} fill="var(--tile-face)" />
            </g>
          ))}
          <Corner text={String(rank)} />
        </>
      );
    case 'bamboo':
      if (rank === 1) {
        // The sparrow that traditionally stands in for 1 bamboo.
        return (
          <>
            <path d="M8 27c0-8 5-14 12-14 3 0 5 2 5 4l-3 1c-1 6-5 11-11 12z" fill={GREEN} />
            <path d="M11 26c2-4 5-7 9-8" stroke={BLUE} strokeWidth="1.6" fill="none" />
            <circle cx="20.5" cy="16.5" r="1.2" fill={INK} />
            <path d="M25 17l3.5 1-3.5 1.5z" fill={RED} />
            <path d="M11 29l-2 6M14 29l1 6" stroke={RED} strokeWidth="1.4" />
            <Corner text="1" />
          </>
        );
      }
      return (
        <>
          {STICKS[rank].map(([x, y, c], i) => (
            <g key={i}>
              <rect x={x} y={y} width="3.4" height="10" rx="1.6" fill={c} />
              <rect x={x - 0.3} y={y + 4.4} width="4" height="1.2" fill="var(--tile-face)" opacity="0.8" />
            </g>
          ))}
          <Corner text={String(rank)} />
        </>
      );
    case 'winds':
      return (
        HAS_CJK ? (
          <>
            <Glyph ch={WINDS[rank - 1]} y={29} size={20} color={INK} />
            <Corner text={'ESWN'[rank - 1]} color={BLUE} />
          </>
        ) : (
          <Fallback text={'ESWN'[rank - 1]} y={28} size={20} color={INK} />
        )
      );
    case 'dragons':
      if (rank === 3) {
        return (
          <>
            <rect x="6" y="8" width="18" height="25" rx="1.5" fill="none" stroke={BLUE} strokeWidth="2.2" />
            <rect x="9" y="11" width="12" height="19" rx="1" fill="none" stroke={BLUE} strokeWidth="1" />
          </>
        );
      }
      if (rank === 1) {
        // 中 drawn as strokes, so it looks the same on every device.
        return (
          <>
            <rect x="7.5" y="13" width="15" height="10" rx="0.8" fill="none" stroke={RED} strokeWidth="2.6" />
            <path d="M15 7v27" stroke={RED} strokeWidth="2.8" />
            <Corner text="R" color={RED} />
          </>
        );
      }
      return HAS_CJK ? (
        <>
          <Glyph ch="發" y={29} size={20} color={GREEN} />
          <Corner text="G" color={GREEN} />
        </>
      ) : (
        <Fallback text="G" y={28} size={20} color={GREEN} />
      );
    case 'flowers':
      return HAS_CJK ? (
        <>
          <Glyph ch={FLOWERS[rank - 1]} y={29} size={18} color={RED} />
          <Corner text={String(rank)} color={RED} />
        </>
      ) : (
        <>
          <Fallback text={String(rank)} y={23} size={17} color={RED} />
          <Fallback text="FLWR" y={34} size={6.5} color={RED} />
        </>
      );
    default:
      return HAS_CJK ? (
        <>
          <Glyph ch={SEASONS[rank - 1]} y={29} size={18} color={BLUE} />
          <Corner text={String(rank)} color={BLUE} />
        </>
      ) : (
        <>
          <Fallback text={String(rank)} y={23} size={17} color={BLUE} />
          <Fallback text="SEASN" y={34} size={6} color={BLUE} />
        </>
      );
  }
}

export type TileSize = 'xs' | 'sm' | 'md' | 'lg';

export interface TileProps {
  /** A tile character, or '' for a face-down tile. */
  tile: string;
  size?: TileSize;
  /** Ring it as the tile on offer / last thrown. */
  highlight?: boolean;
}

export const Tile = memo(function Tile({ tile, size = 'md', highlight = false }: TileProps) {
  if (!tile) return <span className={`tile tile--${size} tile--back`} aria-hidden="true" />;
  return (
    <span className={`tile tile--${size}`} data-highlight={highlight ? 'true' : undefined} role="img" aria-label={tileName(tile)}>
      <svg viewBox="0 0 30 40" className="tile__art" aria-hidden="true" focusable="false">
        <Face tile={tile} />
      </svg>
    </span>
  );
});

/** A row of tiles, e.g. a meld. */
export function TileRow({ tiles, size = 'sm', label }: { tiles: string; size?: TileSize; label?: string }) {
  return (
    <span className="tile-row" aria-label={label}>
      {Array.from(tiles).map((t, i) => (
        <Tile key={i} tile={t} size={size} />
      ))}
    </span>
  );
}
