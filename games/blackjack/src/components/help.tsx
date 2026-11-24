/** "How to play", as a modal reachable from every screen. */
import { parseCards } from '@/engine';
import { CardView } from '@/components/card';
import { Modal } from '@/components/modal';
import './help.css';

const EXAMPLES: readonly { name: string; cards: string; note: string }[] = [
  { name: 'Blackjack', cards: 'As Kh', note: 'An Ace and a ten-card as your first two: paid 3 to 2 (rounded down to a whole chip)' },
  { name: 'Soft 17', cards: 'Ad 6c', note: 'The Ace counts 11 until that would bust you' },
  { name: 'Hard 17', cards: 'Tc 7d', note: 'No Ace to fall back on: one more card risks a bust' },
  { name: 'Bust', cards: 'Kc 6s 9h', note: 'Over 21: the bet is lost, whatever the dealer does' },
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          Everybody plays against <strong>Duchess, the dealer</strong>, not against each other. Get closer to{' '}
          <strong>21</strong> than the dealer without going over. Number cards count their number, Jacks, Queens and
          Kings count 10, and an Ace counts 11 or 1, whichever helps.
        </p>
        <p>
          Each round starts with a <strong>bet</strong>: tap the 10, 25, 50 and 100 chips to build it up (10 to 500), or sit the round out. Everyone gets two cards face
          up; the dealer shows one card and keeps one face down. On your turn:
        </p>
        <ul className="help__list">
          <li>
            <strong>Hit</strong> — take another card. Go over 21 and you bust.
          </li>
          <li>
            <strong>Stand</strong> — keep what you have.
          </li>
          <li>
            <strong>Double</strong> — on your first two cards: double the bet, take exactly one more card.
          </li>
          <li>
            <strong>Split</strong> — two cards of the same value: put up a second bet and play them as two hands (up to
            four). Split Aces get one card each.
          </li>
          <li>
            <strong>Surrender</strong> — on your first two cards only: give up the hand and get half your bet back.
          </li>
        </ul>
        <p>
          Then the dealer turns the hidden card and <strong>must draw to 17</strong> — and, Vegas style,{' '}
          <strong>hits a soft 17</strong> (an Ace and a 6). Beat the dealer and you win your bet back plus the same
          again; a tie (a <em>push</em>) returns your bet.
        </p>
        <p>
          If the dealer shows a ten, she checks for blackjack straight away. If she shows an <strong>Ace</strong>, she
          first offers <strong>insurance</strong>: a side bet of half your bet that she has blackjack, paid 2 to 1. With
          a blackjack of your own it is called <strong>even money</strong> — you are paid 1 to 1 whatever she has. Then
          she peeks; a dealer blackjack takes every bet that is not a blackjack.
        </p>
        <p>
          The game lasts a set number of rounds. Whoever has the most chips at the end wins; run out and you are done.
        </p>

        <h3 className="help__heading">Hands to know</h3>
        <ol className="help__ranks">
          {EXAMPLES.map((r) => (
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
        <h3 className="help__heading">House rules (Las Vegas Strip)</h3>
        <ul className="help__list">
          <li>Six decks; reshuffled when the cut card comes out (the shoe gauge by Duchess shows how close it is).</li>
          <li>Dealer hits soft 17 and peeks for blackjack under an Ace or a ten.</li>
          <li>Blackjack pays 3 to 2; insurance pays 2 to 1; late surrender returns half.</li>
          <li>Double on any two cards, also after a split. Split to four hands; split Aces get one card.</li>
          <li>Payouts that would make half a chip are rounded down.</li>
        </ul>
        <p className="help__foot">Duchess calls every change at the table as it happens — read her line under the menu.</p>
      </div>
    </Modal>
  );
}
