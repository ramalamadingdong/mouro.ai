/**
 * Card faces, backs and suit marks, all inline SVG and CSS. A card is the
 * engine's two-character string (`fA`, `y8`, `bT`).
 *
 * Suits differ by shape as well as ink — a fish, a ball of yarn, a mouse and
 * a bell — so colour is never the only cue. Every eight is a tabby: the wild
 * card has a cat's face on it.
 */
import { isWild, rankOf, suitOf, type Suit } from '@/engine';
import './cards.css';

/** One suit mark, in a 24×24 box, drawn in currentColor. */
export function SuitMark({ suit, className }: { suit: Suit; className?: string }) {
  return (
    <svg className={className ?? 'suit'} viewBox="0 0 24 24" aria-hidden="true" data-suit={suit}>
      {suit === 'f' && (
        <g fill="currentColor">
          <path d="M3 12c3.2-4.6 9.6-6 14-1.4L21.5 7v10L17 13.4C12.6 18 6.2 16.6 3 12Z" />
          <circle cx="7.4" cy="11.2" r="1.15" fill="var(--card)" />
          <path d="M11 9.2c1 1.6 1 4 0 5.6" stroke="var(--card)" strokeWidth="1" fill="none" strokeLinecap="round" />
        </g>
      )}
      {suit === 'y' && (
        <g>
          <circle cx="11" cy="11" r="8" fill="currentColor" />
          <g stroke="var(--card)" strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.85">
            <path d="M5 7.5c3.5 1 7.5 5 9 11" />
            <path d="M8.5 3.6c2.4 2 5 6.5 5.6 9.8" />
            <path d="M3.4 12.6c4-.6 9 .4 13.6 3.6" />
          </g>
          <path d="M17 17c2 1.6 3.6 1.2 4.6 3.6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
      {suit === 'm' && (
        <g fill="currentColor">
          <path d="M3.5 15.5C4 10 8.6 6.8 13.5 7.4c4 .5 6.6 3.6 6.6 8.1H3.5Z" />
          <circle cx="8.6" cy="7.6" r="2.9" />
          <circle cx="8.6" cy="7.6" r="1.4" fill="var(--card)" opacity="0.6" />
          <circle cx="5.9" cy="12.6" r="0.95" fill="var(--card)" />
          <path d="M20 15.2c2 .4 2.4 2.6.6 3.6-1.4.8-3.6.2-5 .8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </g>
      )}
      {suit === 'b' && (
        <g fill="currentColor">
          <path d="M12 3.2a1.6 1.6 0 0 1 1.6 1.6v.4c3.3.8 5 3.6 5 7.2v3.2l1.9 2.2H3.5l1.9-2.2v-3.2c0-3.6 1.7-6.4 5-7.2v-.4A1.6 1.6 0 0 1 12 3.2Z" />
          <circle cx="12" cy="19.6" r="2" />
          <path d="M8 12.4c.2-2 1.2-3.4 2.8-4" stroke="var(--card)" strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.8" />
        </g>
      )}
    </svg>
  );
}

/** The tabby face in the middle of every eight. */
function TabbyFace() {
  return (
    <svg className="card__tabby" viewBox="0 0 40 36" aria-hidden="true">
      <path d="M4 3l10 8h12l10-8 1 15c0 9-8 15-17 15S3 27 3 18Z" fill="var(--back)" />
      <g stroke="var(--back-stripe)" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M20 11v5M15.5 12l1 4M24.5 12l-1 4" />
        <path d="M5 20h5M5 24l5-1.5M35 20h-5M35 24l-5-1.5" />
      </g>
      <ellipse cx="14" cy="20" rx="2.4" ry="3" fill="#2b2720" />
      <ellipse cx="26" cy="20" rx="2.4" ry="3" fill="#2b2720" />
      <circle cx="14.7" cy="19" r="0.8" fill="#fff" />
      <circle cx="26.7" cy="19" r="0.8" fill="#fff" />
      <path d="M18.4 25h3.2L20 27Z" fill="#e8908a" />
      <path d="M20 27c-1 1.6-3 1.6-3.6.6M20 27c1 1.6 3 1.6 3.6.6" stroke="#2b2720" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const RANK_LABEL: Record<string, string> = { T: '10' };

export interface CardProps {
  card: string;
  /** Small cards for the pile history and the round summary. */
  size?: 'small' | 'normal' | 'large';
  className?: string;
}

/** A face-up card. Decorative markup; the caller gives the accessible name. */
export function CardFace({ card, size = 'normal', className }: CardProps) {
  const suit = suitOf(card);
  const rank = RANK_LABEL[rankOf(card)] ?? rankOf(card);
  const wild = isWild(card);
  return (
    <span className={`card card--${size} ${className ?? ''}`} data-suit={suit} data-wild={wild ? 'true' : 'false'}>
      <span className="card__corner">
        <span className="card__rank">{rank}</span>
        <SuitMark suit={suit} className="card__pip" />
      </span>
      <span className="card__middle">{wild ? <TabbyFace /> : <SuitMark suit={suit} className="card__big" />}</span>
      <span className="card__corner card__corner--far" aria-hidden="true">
        <span className="card__rank">{rank}</span>
      </span>
    </span>
  );
}

/** The back of a card: ginger tabby stripes. */
export function CardBack({ size = 'normal' }: { size?: CardProps['size'] }) {
  return <span className={`card card--${size} card--back`} aria-hidden="true" />;
}

