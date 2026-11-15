/** "How to play", as a modal reachable from every screen. */
import { PTS, RULES } from '@/engine';
import { Modal } from '@/components/modal';
import './help.css';

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          Every round, cats wait <strong>at the door</strong>. In turn, each player takes one and seats it somewhere on
          their own café floor. Cats can be rotated and flipped, but never moved once seated. The first pick passes to
          the next player each round.
        </p>
        <p>
          Tap a cat to pick it up (tap it again to rotate), tap or drag on your floor to choose a spot, then{' '}
          <strong>seat it</strong>. With a mouse, just click the spot. A cat that fits nowhere has to be sent away.
        </p>
        <h3 className="help__heading">Scoring</h3>
        <ul className="help__tips">
          <li>
            <strong>+{PTS.friend}</strong> for each pair of touching cats with the same coat.
          </li>
          <li>
            <strong>−{PTS.spat}</strong> for each pair of touching rivals: Ginger and Smoke cannot stand each other, and
            neither can Tuxedo and Snow.
          </li>
          <li>
            <strong>+{PTS.row}</strong> for each row filled from wall to wall.
          </li>
        </ul>
        <p>After {RULES.ROUNDS} rounds, the café with the most points wins.</p>
        <h3 className="help__heading">Tips</h3>
        <ul className="help__tips">
          <li>Two cats count as one pair however long the border they share, so many small friends beat one long one.</li>
          <li>A single empty square can never be filled. Watch the gaps you leave in a row you want to finish.</li>
          <li>Everyone can see every floor. Sometimes the best cat to take is the one your neighbour needs.</li>
        </ul>
        <p className="help__keys">Keyboard: number keys pick a cat, arrows move it, R rotates, F flips, Enter seats it.</p>
      </div>
    </Modal>
  );
}
