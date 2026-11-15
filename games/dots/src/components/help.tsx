/** "How to play", as a modal reachable from every screen. */
import { Modal } from '@/components/modal';
import './help.css';

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          Take turns drawing <strong>one line</strong> between two dots that sit next to each other, across or down.
          Tap anywhere near a line to draw it.
        </p>
        <p>
          Draw the <strong>fourth side of a box</strong> and it is yours: it fills with your colour and you{' '}
          <strong>draw again</strong>. Keep going as long as you keep closing boxes. A line that closes nothing passes
          the turn on.
        </p>
        <p>When every box is taken, whoever has the most wins.</p>
        <h3 className="help__heading">Tips</h3>
        <ul className="help__tips">
          <li>Try not to draw the third side of a box — that hands it to the next player.</li>
          <li>
            Late in the game every line gives something away. Give away the <em>shortest</em> chain of boxes you can.
          </li>
          <li>
            The expert move: at the end of a long chain, leave the last two boxes for your opponent. Then they have to
            open the next chain for you.
          </li>
        </ul>
      </div>
    </Modal>
  );
}
