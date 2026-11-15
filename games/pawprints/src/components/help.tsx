/** "How to play", as a modal reachable from every screen. */
import { Modal } from '@/components/modal';
import './help.css';

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="How to play" onClose={onClose}>
      <div className="help">
        <p>
          Take turns leaving <strong>one paw print</strong> where two stitched seams of the quilt cross. Tap a point to
          choose it, then tap <strong>Leave a paw here</strong> (or tap the same point again). With a mouse, one click
          plays.
        </p>
        <p>
          The first to make an unbroken line of <strong>five of their own paws</strong> — across, down or corner to
          corner — wins. A longer line counts too. With three or four players, <strong>four in a row</strong> is
          enough.
        </p>
        <p>If the quilt fills up and nobody has a line, it is a draw.</p>
        <h3 className="help__heading">Tips</h3>
        <ul className="help__tips">
          <li>Start near the middle: lines from the edge run out of room.</li>
          <li>
            Watch for three in a row with both ends open — if you do not block one end now, it becomes four with two
            ends, and nobody can block both.
          </li>
          <li>
            The winning trick: one paw that makes two threats at once. The others can only block one of them.
          </li>
        </ul>
      </div>
    </Modal>
  );
}
