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
 * THE INPUT COVERS THE BOXES, transparently, and has no `maxLength`. It used to
 * be a 1px field capped at five characters, which typed fine and broke the two
 * things above that this design exists for: there was nothing to long-press, so
 * "Paste" was unreachable on a phone, and the cap truncated a paste or an
 * autofill before `handleChange` saw it — a pasted invite became "JOINM", the
 * first five letters of the message. `extractRoomCode` is what keeps the value
 * to five characters now.
 *
 * Presentational: the value is owned by the caller.
 */

import { useEffect, useId, useRef, useState } from "react";
import { CODE_LENGTH, extractRoomCode } from "@/util/seed";
import "./code-input.css";

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
  label = "Room code",
  error = null,
  disabled = false,
  autoFocus = false,
}: CodeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  // Decided after mount: the clipboard API is not there to ask during render.
  const [canPaste, setCanPaste] = useState(false);
  const [pasteMissed, setPasteMissed] = useState(false);

  /*
   * The caret. Derived, never stored: it is simply the next empty box, or the
   * last box once the code is full. Storing it would mean keeping it in sync
   * with the value on paste, backspace, and autofill — three more chances to
   * be wrong.
   */
  const caret = Math.min(value.length, CODE_LENGTH - 1);

  function handleChange(raw: string) {
    // Extract on EVERY change, not on submit: this is what makes a pasted
    // invite message, a link or "Room code: AB3CD" collapse to the code itself
    // as it lands, and what stops a lowercase letter ever appearing in a box.
    const next = extractRoomCode(raw);
    setPasteMissed(false);
    onChange(next);
    // Auto-submit fires here rather than in an effect so it happens exactly
    // once, on the keystroke that completed the code. An effect keyed on
    // `value` would re-fire on any re-render that reached full length again.
    if (next.length === CODE_LENGTH) onSubmit?.(next);
  }

  // The WebOTP effect below runs once but must call the CURRENT handler.
  const latestChange = useRef(handleChange);
  useEffect(() => {
    latestChange.current = handleChange;
  });

  useEffect(() => {
    // lib.dom types the clipboard as always present; it is absent on insecure
    // origins and in some in-app browsers.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    setCanPaste(typeof clipboard?.readText === "function");

    /*
     * ANDROID: READ THE CODE STRAIGHT OUT OF A TEXT MESSAGE (WebOTP).
     *
     * `autoComplete="one-time-code"` is enough on iOS, which offers the code
     * above the keyboard by itself. Chrome on Android does nothing with that
     * attribute alone — it has to be ASKED, with this call. When a text whose
     * last line is `@host #CODE` arrives (the invite ends with exactly that —
     * see handleShare in routes/lobby.tsx), Android shows its own "allow" sheet
     * and resolves with the code. It only covers SMS, and only messages that
     * arrive while this screen is open; an invite that came earlier, or over
     * WhatsApp, is what the Paste button is for.
     */
    if (!("OTPCredential" in window)) return;
    const abort = new AbortController();
    const request = {
      otp: { transport: ["sms"] },
      signal: abort.signal,
    } as CredentialRequestOptions;
    navigator.credentials
      .get(request)
      .then((credential) => {
        const otp = (credential as { code?: string } | null)?.code ?? "";
        if (extractRoomCode(otp).length === CODE_LENGTH)
          latestChange.current(otp);
      })
      .catch(() => {
        // Aborted on unmount, timed out or declined. Typing and pasting still work.
      });
    return () => abort.abort();
  }, []);

  async function handlePaste() {
    try {
      const pasted = await navigator.clipboard.readText();
      if (extractRoomCode(pasted).length === CODE_LENGTH) handleChange(pasted);
      else setPasteMissed(true);
    } catch {
      // Permission refused, or nothing readable on the clipboard.
      setPasteMissed(true);
    }
  }

  return (
    <div className="code" data-disabled={disabled ? "true" : undefined}>
      <label className="code__label" htmlFor={inputId}>
        {label}
      </label>

      {/*
       * The real input is laid over the boxes (see code-input.css), so a tap or
       * a long-press anywhere on them lands on it. The boxes are not focusable
       * themselves, so there is exactly one tab stop.
       */}
      <div className="code__field">
        <div className="code__boxes" aria-hidden="true">
          {SLOTS.map((i) => (
            <span
              key={i}
              className="code__box"
              data-filled={value[i] ? "true" : undefined}
              data-caret={
                !disabled && i === caret && value.length < CODE_LENGTH
                  ? "true"
                  : undefined
              }
            >
              {value[i] ?? ""}
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
            if (e.key === "Enter" && onSubmit) onSubmit(value);
          }}
          disabled={disabled}
          autoFocus={autoFocus}
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
      </div>

      {canPaste && !disabled ? (
        <button
          type="button"
          className="code__paste"
          onClick={() => void handlePaste()}
        >
          Paste code
        </button>
      ) : null}
      {pasteMissed ? (
        <p className="code__hint">
          Couldn’t find a room code in what you copied — copy the invite message
          and try again.
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="code__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default CodeInput;
