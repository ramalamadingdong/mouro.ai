/**
 * Room-code entry: five character boxes backed by ONE real input.
 *
 * THE TRICK, and why it is worth it: the obvious implementation is five
 * separate <input maxLength=1> elements that move focus to their neighbour on
 * every keystroke. That version breaks in all the ways that matter on a phone —
 * pasting a code fills only the first box, iOS autofill and the "from Messages"
 * keyboard suggestion target one box, backspace across a boundary needs a
 * keydown hack, and every focus jump risks the software keyboard dismissing and
 * reopening. A single input has none of those problems: paste, autofill,
 * selection, IME, and the keyboard all behave because they are talking to a
 * normal text field. The five boxes are just painted underneath it, and the
 * "focused box" is DERIVED from the value's length rather than being real focus
 * that has to be juggled.
 *
 * Presentational: the value is owned by the caller.
 */

import { useId, useRef } from 'react';
import { CODE_LENGTH, sanitizeRoomCode } from '@/util/seed';
import './code-input.css';

export interface CodeInputProps {
  /** The current code. Always already sanitized (uppercase, alphabet-only). */
  value: string;
  /** Called with the sanitized value on every keystroke. */
  onChange: (value: string) => void;
  /** Called once the value reaches CODE_LENGTH. Also fired on Enter. */
  onSubmit?: (value: string) => void;
  /** Visible label above the boxes. */
  label?: string;
  /** Error prose shown under the boxes. Must be actionable, not a code. */
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
}

const SLOTS = Array.from({ length: CODE_LENGTH }, (_, i) => i);

export function CodeInput({
  value,
  onChange,
  onSubmit,
  label = 'Room code',
  error = null,
  disabled = false,
  autoFocus = false,
}: CodeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  /*
   * The caret. Derived, never stored: it is simply the next empty box, or the
   * last box once the code is full. Storing it would mean keeping it in sync
   * with the value on paste, backspace, and autofill — three more chances to
   * be wrong.
   */
  const caret = Math.min(value.length, CODE_LENGTH - 1);

  function handleChange(raw: string) {
    // Sanitize on EVERY keystroke, not on submit: this is what makes a pasted
    // invite URL or "Room code: AB3CD" collapse to the code itself as it lands,
    // and what stops a lowercase letter ever appearing in a box.
    const next = sanitizeRoomCode(raw);
    onChange(next);
    // Auto-submit fires here rather than in an effect so it happens exactly
    // once, on the keystroke that completed the code. An effect keyed on
    // `value` would re-fire on any re-render that reached full length again.
    if (next.length === CODE_LENGTH) onSubmit?.(next);
  }

  return (
    <div className="code" data-disabled={disabled ? 'true' : undefined}>
      <label className="code__label" htmlFor={inputId}>
        {label}
      </label>

      {/*
       * Clicking anywhere on the boxes focuses the one real input. The boxes
       * are not focusable themselves, so there is exactly one tab stop.
       */}
      <div
        className="code__boxes"
        onClick={() => inputRef.current?.focus()}
        aria-hidden="true"
      >
        {SLOTS.map((i) => (
          <span
            key={i}
            className="code__box"
            data-filled={value[i] ? 'true' : undefined}
            data-caret={!disabled && i === caret && value.length < CODE_LENGTH ? 'true' : undefined}
          >
            {value[i] ?? ''}
          </span>
        ))}
      </div>

      <input
        id={inputId}
        ref={inputRef}
        className="code__input"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits whatever is there; the caller decides whether it is
          // long enough. Without this, a full-length code that was corrected
          // back down and up again has no keyboard path to submit.
          if (e.key === 'Enter' && onSubmit) onSubmit(value);
        }}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={CODE_LENGTH}
        /* The code alphabet is digits AND capitals, so `numeric` would hide the
           letters and `text` shows the full keyboard. `autoCapitalize` still
           matters: the field displays uppercase, and a lowercase-looking
           keyboard makes people think they typed the wrong thing. */
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        /* `one-time-code` is what makes iOS and Android offer the code from a
           text message above the keyboard — the single biggest quality-of-life
           win for a room code people share over chat. */
        autoComplete="one-time-code"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />

      {error ? (
        <p id={errorId} className="code__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default CodeInput;
