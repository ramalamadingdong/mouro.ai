/**
 * A modal dialog, built on the native <dialog> element.
 *
 * Native rather than a hand-rolled overlay because `showModal()` gives us the
 * three things a hand-rolled one always gets wrong: a real focus trap, the top
 * layer (so no z-index fight with the sticky scorecard header), and inertness
 * of the page behind it for screen readers. Escape-to-close comes free too.
 *
 * Presentational: `open` and `onClose` are the caller's.
 */

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import './modal.css';

export interface ModalProps {
  open: boolean;
  /** Headline. Also the dialog's accessible name. */
  title: string;
  children: ReactNode;
  /** Buttons row. Rendered in a footer with the caller's own ordering. */
  footer?: ReactNode;
  /**
   * Called on Escape, on a backdrop click, and by the close button. Omit it
   * together with `dismissible: false` for a modal the player must answer.
   */
  onClose?: () => void;
  /**
   * When false, Escape and backdrop clicks are swallowed and no close button is
   * drawn. Use for a genuinely blocking state (game over with a required
   * choice), never merely to keep someone reading.
   */
  dismissible?: boolean;
}

export function Modal({
  open,
  title,
  children,
  footer,
  onClose,
  dismissible = true,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Two modals can be mounted at once (a confirm on top of a game-over sheet),
  // so the title id has to be unique per instance rather than a constant.
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open && !el.open) {
      // `showModal` is absent in jsdom (and in any non-browser test runner), so
      // fall back to the plain `open` attribute rather than throwing. The
      // fallback loses the focus trap, which is acceptable in a test but is
      // why we never rely on it in the browser.
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  /*
   * The dialog element is ALWAYS rendered, even when closed (it is
   * `display: none` until opened). Unmounting it would null the ref and leave
   * the effect above with nothing to call — and it would also discard the
   * dialog's own state mid-close-animation.
   */
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        // `cancel` fires on Escape. Preventing it is the ONLY way to stop the
        // browser closing a native dialog on Escape.
        if (!dismissible) {
          e.preventDefault();
          return;
        }
        e.preventDefault(); // let React state drive `open`, not the DOM
        onClose?.();
      }}
      onClick={(e) => {
        // A click on the backdrop has the dialog itself as its target, because
        // the backdrop is the dialog's own ::backdrop pseudo-element. Anything
        // inside the panel targets a descendant, so this comparison is a
        // reliable "clicked outside".
        if (!dismissible) return;
        if (e.target === ref.current) onClose?.();
      }}
      aria-labelledby={titleId}
    >
      <div className="modal__panel">
        <header className="modal__head">
          <h2 className="modal__title" id={titleId}>
            {title}
          </h2>
          {dismissible && onClose ? (
            <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
              {'×'}
            </button>
          ) : null}
        </header>

        <div className="modal__body">{children}</div>

        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

export default Modal;
