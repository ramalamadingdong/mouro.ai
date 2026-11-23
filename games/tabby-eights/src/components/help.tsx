/** "How to play", as a modal reachable from every screen. */
import { Modal } from '@/components/modal';
import { SuitMark } from '@/components/cards';
import './help.css';

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          The deck has four suits — <SuitMark suit="f" /> fish, <SuitMark suit="y" /> yarn, <SuitMark suit="m" /> mice
          and <SuitMark suit="b" /> bells — ace to king. Everyone gets <strong>seven cards</strong> (five with three or
          four players) and one card is turned up on the pile.
        </p>
        <p>
          On your turn, play one card that matches the pile’s <strong>suit</strong> or its <strong>number</strong>.
          Every <strong>eight is a wild tabby</strong>: play it on anything and name the suit the next player must
          follow.
        </p>
        <p>
          Nothing you want to play? <strong>Draw one card</strong> from the stock, then play a card or pass. When the
          stock runs out, the pile under its top card is shuffled back in.
        </p>
        <p>
          The first to play their last card wins the round and scores for every card left in the others’ paws:{' '}
          <strong>eights 50</strong>, kings, queens, jacks and tens 10, aces 1, the rest their number. First to the
          target wins the game.
        </p>
        <h3 className="help__heading">Tips</h3>
        <ul className="help__tips">
          <li>Keep your eights for when you are stuck — or for your very last card.</li>
          <li>Match by number to switch to a suit you hold lots of.</li>
          <li>When someone is down to one card, get rid of your big cards: they are worth points to whoever goes out.</li>
        </ul>
      </div>
    </Modal>
  );
}
