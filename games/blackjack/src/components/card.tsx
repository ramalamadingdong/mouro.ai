/**
 * A playing card drawn entirely in CSS and inline SVG — no image assets, and
 * no suit characters: the ♥ ♠ glyphs render as colour emoji on some phones,
 * which ignores our colours and looks nothing like a card.
 */
import { RANK_CHARS, rankOf, suitOf, type Card } from '@/engine';
import './card.css';

const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];

/** One suit pip in a 24×24 box. `currentColor`, so the card's CSS colours it. */
function SuitPip({ suit }: { suit: number }) {
  return (
    <svg className="card__pip" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {suit === 0 && (
        <g fill="currentColor">
          <circle cx="12" cy="7.2" r="4.6" />
          <circle cx="6.6" cy="14" r="4.6" />
          <circle cx="17.4" cy="14" r="4.6" />
          <path d="M12 11c0 5-.9 8.2-3 10.5h6c-2.1-2.3-3-5.5-3-10.500z" />
        </g>
      )}
      {suit === 1 && <path fill="currentColor" d="M12 1.5 20 12l-8 10.500L4 12z" />}
      {suit === 2 && (
        <path
          fill="currentColor"
          d="M12 21.500S3 15.2 3 8.700A4.7 4.7 0 0 1 12 6.3 4.7 4.7 0 0 1 21 8.700C21 15.2 12 21.5 12 21.500z"
        />
      )}
      {suit === 3 && (
        <path
          fill="currentColor"
          d="M12 1.500s8.5 6.3 8.5 11.700a4.3 4.3 0 0 1-7.3 3.100c.2 2.1.9 3.8 2.1 5.200H8.700c1.2-1.4 1.9-3.1 2.1-5.200a4.3 4.3 0 0 1-7.3-3.100C3.5 7.8 12 1.5 12 1.500z"
        />
      )}
    </svg>
  );
}

export interface CardViewProps {
  /** Omit (or pass `faceDown`) for a card back. */
  card?: Card;
  faceDown?: boolean;
  /** lg: your hand. md: the dealer's, and your split hands. sm: other seats. */
  size: 'lg' | 'md' | 'sm';
  /** A winning hand, once the round is settled. */
  winning?: boolean;
  /** Greyed: a losing hand, once the round is settled. */
  dim?: boolean;
}

export function CardView({ card, faceDown = false, size, winning = false, dim = false }: CardViewProps) {
  const classes = `card card--${size}${winning ? ' card--winning' : ''}${dim ? ' card--dim' : ''}`;
  if (card === undefined || faceDown) {
    return <span className={`${classes} card--back`} role="img" aria-label="Face-down card" />;
  }
  const rank = rankOf(card);
  const suit = suitOf(card);
  const red = suit === 1 || suit === 2;
  return (
    <span
      className={`${classes}${red ? ' card--red' : ''}`}
      role="img"
      aria-label={`${RANK_NAMES[rank]} of ${SUIT_NAMES[suit]}`}
    >
      {/* "10", not "T": nobody outside a hand history reads T as ten. */}
      <span className="card__rank">{rank === 8 ? '10' : RANK_CHARS[rank]}</span>
      <SuitPip suit={suit} />
    </span>
  );
}
