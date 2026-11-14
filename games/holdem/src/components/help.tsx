/** "How to play" and the hand rankings, as a modal reachable from every screen. */
import { parseCards } from '@/engine';
import { CardView } from '@/components/card';
import { Modal } from '@/components/modal';
import './help.css';

// Strongest first. The example is the five cards that make the hand.
const RANKINGS: readonly { name: string; cards: string; note: string }[] = [
  { name: 'Royal flush', cards: 'As Ks Qs Js Ts', note: 'Ace-high straight, all one suit' },
  { name: 'Straight flush', cards: '9h 8h 7h 6h 5h', note: 'Five in a row, all one suit' },
  { name: 'Four of a kind', cards: 'Kc Kd Kh Ks 4d', note: 'Four cards of one rank' },
  { name: 'Full house', cards: 'Tc Td Th 4s 4d', note: 'Three of one rank, two of another' },
  { name: 'Flush', cards: 'Ad Jd 8d 4d 2d', note: 'Five of one suit' },
  { name: 'Straight', cards: 'Tc 9d 8h 7s 6c', note: 'Five in a row (A-2-3-4-5 counts)' },
  { name: 'Three of a kind', cards: '7c 7d 7h Ks 2c', note: 'Three cards of one rank' },
  { name: 'Two pair', cards: 'Kc Kd 5c 5d 9h', note: 'Two different pairs' },
  { name: 'Pair', cards: 'Qc Qd 9c 7d 3h', note: 'Two cards of one rank' },
  { name: 'High card', cards: 'Ac Jd 9c 7d 3h', note: 'None of the above' },
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          Everyone gets <strong>two cards face down</strong>. Five shared cards are then turned over in the middle:
          three (the <em>flop</em>), one (the <em>turn</em>), one (the <em>river</em>). Make the best five-card hand
          you can from your two and the five on the table.
        </p>
        <p>
          There is a round of betting before the flop and after each deal. On your turn you can <strong>fold</strong>{' '}
          (give up the hand), <strong>check</strong> (pass, if nobody has bet), <strong>call</strong> (match the bet)
          or <strong>bet / raise</strong> any amount up to everything you have — that is the “no limit”.
        </p>
        <p>
          Two players post forced bets each hand, the <strong>blinds</strong>, and the dealer button{' '}
          <span className="dealer-button dealer-button--inline">D</span> moves round one seat each hand. The blinds go
          up every few hands so the game finishes. Win the pot by showing the best hand, or by betting until everyone
          else folds. Lose all your chips and you are out; the last player with chips wins.
        </p>
        <p>
          If a player is all-in for less than the others bet, they can only win what they matched: the rest goes into
          a <strong>side pot</strong> for the players who put more in.
        </p>

        <h3 className="help__heading">Hand rankings, best first</h3>
        <ol className="help__ranks">
          {RANKINGS.map((r) => (
            <li key={r.name} className="help__rank">
              <span className="help__cards">
                {parseCards(r.cards).map((c) => (
                  <CardView key={c} card={c} size="sm" />
                ))}
              </span>
              <span className="help__text">
                <strong>{r.name}</strong>
                <span>{r.note}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="help__foot">Ties are broken by the highest cards in the hand; identical hands split the pot.</p>
      </div>
    </Modal>
  );
}
