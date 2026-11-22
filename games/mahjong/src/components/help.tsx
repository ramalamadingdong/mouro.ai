/** "How to play", as a modal reachable from every screen. */
import { LIMIT_FAAN } from '@/engine';
import { Modal } from '@/components/modal';
import { TileRow } from '@/components/tile';
import './help.css';

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          Four players, 144 tiles, Hong Kong rules. Make a hand of <strong>four sets and a pair</strong>: 14 tiles. A
          set is a <strong>chow</strong> (a run of three in one suit, <TileRow tiles="jkl" size="xs" />), a{' '}
          <strong>pung</strong> (three the same, <TileRow tiles="FFF" size="xs" />) or a <strong>kong</strong> (four
          the same).
        </p>
        <h3 className="help__heading">Your turn</h3>
        <p>
          You draw a tile automatically, then throw one: tap it, then tap it again (or use the Throw button). If your 14
          tiles make a winning hand, press <strong>Mahjong!</strong> Four the same in your hand can be declared as a
          kong; you then draw a replacement.
        </p>
        <h3 className="help__heading">Calling a thrown tile</h3>
        <ul className="help__tips">
          <li>
            <strong>Pung</strong> or <strong>kong</strong>: anyone holding two (or three) of it. Play then continues from
            you.
          </li>
          <li>
            <strong>Chow</strong>: only the next player after the one who threw it.
          </li>
          <li>
            <strong>Mahjong</strong> beats every other call. Called sets go face up on the table.
          </li>
        </ul>
        <p>You are only asked when you could call the tile. If nobody calls it, the next player draws.</p>
        <h3 className="help__heading">Flowers and seasons</h3>
        <p>
          The eight bonus tiles <TileRow tiles="IM" size="xs" /> are set aside as soon as they arrive and replaced. Your
          own flower and season (East 1, South 2, West 3, North 4) each score a faan.
        </p>
        <h3 className="help__heading">Scoring</h3>
        <p>
          A winning hand scores <strong>faan</strong>; the table can ask for a minimum. Some of them:
        </p>
        <ul className="help__tips">
          <li>Self-drawn, concealed hand (no calls), no flowers, all chows: 1 each</li>
          <li>Pung of dragons, of your seat wind, or of the round wind: 1 each</li>
          <li>All pungs 3, mixed one suit (one suit + honours) 3, pure one suit 7</li>
          <li>Small three dragons 5; great three dragons, great four winds, all honours, thirteen orphans: the limit ({LIMIT_FAAN})</li>
        </ul>
        <p>
          A thrown winning tile is paid double by whoever threw it and single by the other two; a self-drawn win is paid
          double by all three. When the wall runs out the hand is a draw.
        </p>
        <h3 className="help__heading">The deal</h3>
        <p>
          The dealer is East. If the dealer wins, or the hand is a draw, they deal again; otherwise the deal passes on.
          When it has been all the way round, the round wind changes. The East round is one trip round the table; a full
          game is four.
        </p>
      </div>
    </Modal>
  );
}
