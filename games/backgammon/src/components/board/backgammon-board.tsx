import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { BoardFrame } from '@/components/board/board-frame';
import { ConfirmModal } from '@/components/board/confirm-modal';
import { EmoteBubble } from '@/components/board/emote-bubble';
import { EmoteTray } from '@/components/board/emote-tray';
import { GameEndModal } from '@/components/board/game-end-modal';
import { MatchEndModal } from '@/components/board/match-end-modal';
import { MoveControls } from '@/components/board/move-controls';
import { PlayerStrip } from '@/components/board/opponent-bar';
import { TurnBanner } from '@/components/board/turn-banner';
import { otherSeat, pipCount } from '@/engine/board';
import type { GameState, Move, Seat } from '@/engine/types';
import { useBoardMetrics } from '@/hooks/use-board-metrics';
import { useBoardMotion, useMotionEnabled } from '@/hooks/use-board-motion';
import { useTurnDraft } from '@/hooks/use-turn-draft';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, text } from '@/theme/colors';
import { randomSeed } from '@/util/seed';

const impact = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};
const success = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};

export type BackgammonBoardProps = {
  state: GameState;
  mySeat: Seat | null;
  send: (move: Move) => void | Promise<void>;
  onLeave: () => void;
  onRematch: () => void;
  /** A move is in flight. */
  pending?: boolean;
  error?: string | null;
  /** Realtime Database socket is up. Solo passes true. */
  connected?: boolean;
  opponentOnline?: boolean;
  /** Overrides the "waiting for X" copy (solo says "Computer is thinking…"). */
  opponentTurnLabel?: string;
  opponentThinking?: boolean;
  rematchVotes?: Record<string, boolean>;
  /** Solo: a rematch takes effect immediately, with nobody to vote. */
  soloRematch?: boolean;
  /** Omitted in solo, which hides the whole reaction UI. */
  onEmote?: (emoji: string) => void;
  myEmote?: { emoji: string; n: number } | null;
  opponentEmote?: { emoji: string; n: number } | null;
};

/**
 * THE board. One component serves both `/game/[code]` (online, via gameStore)
 * and `/solo` (offline, via soloStore) — they differ only in what they pass in,
 * which is what keeps the two modes from drifting apart.
 */
export function BackgammonBoard({
  state,
  mySeat,
  send,
  onLeave,
  onRematch,
  pending = false,
  error = null,
  connected = true,
  opponentOnline = true,
  opponentTurnLabel,
  opponentThinking = false,
  rematchVotes = {},
  soloRematch = false,
  onEmote,
  myEmote = null,
  opponentEmote = null,
}: BackgammonBoardProps) {
  const m = useBoardMetrics();
  const fastTap = useSettingsStore((s) => s.tapToMoveFast);
  const highlight = useSettingsStore((s) => s.highlightLegal);
  const autoConfirm = useSettingsStore((s) => s.autoConfirm);
  const motionOn = useMotionEnabled();

  const draft = useTurnDraft(state, mySeat, { fastTap });

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [requestedNext, setRequestedNext] = useState(false);

  // A new game means the "waiting for the next game" latch is spent.
  useEffect(() => {
    if (state.phase !== 'gameOver') setRequestedNext(false);
  }, [state.phase, state.game]);

  const me: Seat = mySeat ?? 'p0';
  const them = otherSeat(me);
  const myTurn = mySeat !== null && state.turn === mySeat;
  const busy = pending || mySeat === null;


  // ── Actions ───────────────────────────────────────────────────────────────
  const doRoll = () => {
    if (busy) return;
    impact();
    void send(
      state.phase === 'opening'
        ? { kind: 'openingRoll', seed: randomSeed() }
        : { kind: 'roll', seed: randomSeed() },
    );
  };

  const doConfirm = () => {
    if (busy) return;
    if (!draft.canConfirm && !draft.forcedPass) return;
    success();
    void send({ kind: 'play', steps: draft.draft });
  };

  // Auto-confirm fires off the same path as the button, so there is exactly one
  // place a turn can be committed from.
  useEffect(() => {
    if (!autoConfirm || busy || !myTurn) return;
    if (state.phase !== 'moving') return;
    if (!draft.canConfirm || draft.draft.length === 0) return;
    void send({ kind: 'play', steps: draft.draft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConfirm, busy, myTurn, state.phase, draft.canConfirm, draft.draft.length]);

  const tapPoint = (own: number) => {
    if (!myTurn || state.phase !== 'moving') return;
    // The draft updates on the next render, so buzz for a tap that COULD do
    // something rather than trying to observe the result of this one.
    if (draft.next.some((s) => s.from === own || s.to === own)) impact();
    draft.tapPoint(own);
  };

  // ── Copy ──────────────────────────────────────────────────────────────────
  const opponentName = state.names[them] ?? 'Opponent';
  const waitLabel = opponentTurnLabel ?? `${opponentName}'s turn`;

  let banner: {
    label: string;
    tone: 'you' | 'wait' | 'neutral' | 'alert';
    thinking?: boolean;
  };
  if (mySeat === null) {
    banner = { label: 'Taking your seat…', tone: 'neutral', thinking: true };
  } else if (state.phase === 'opening') {
    const mine = state.opening?.[me] ?? null;
    const theirs = state.opening?.[them] ?? null;
    if (myTurn) {
      banner = {
        label:
          theirs !== null
            ? `${opponentName} rolled ${theirs} — roll to answer`
            : 'Roll for first move',
        tone: 'you',
      };
    } else {
      banner = {
        label: mine !== null ? `You rolled ${mine} — waiting` : `${opponentName} rolls first`,
        tone: 'wait',
        thinking: true,
      };
    }
  } else if (!myTurn) {
    banner = { label: waitLabel, tone: 'wait', thinking: opponentThinking };
  } else if (state.phase === 'roll') {
    banner = { label: 'Your roll', tone: 'you' };
  } else if (draft.forcedPass) {
    banner = { label: 'No legal move', tone: 'alert' };
  } else if (draft.onlyPlay && draft.draft.length > 0) {
    banner = { label: 'Only one play — confirm it', tone: 'you' };
  } else {
    const left = draft.maxDice - draft.draft.length;
    banner = {
      label: left > 0 ? `Play ${left} more ${left === 1 ? 'die' : 'dice'}` : 'Confirm your move',
      tone: 'you',
    };
  }

  const mode: 'roll' | 'moving' | 'waiting' =
    !myTurn || mySeat === null
      ? 'waiting'
      : state.phase === 'opening' || state.phase === 'roll'
        ? 'roll'
        : state.phase === 'moving'
          ? 'moving'
          : 'waiting';

  // During the opening roll, show whichever dice have been rolled so far — it
  // is the only moment the two dice belong to different players.
  const baseDisplay: GameState =
    state.phase === 'opening'
      ? {
          ...draft.preview,
          dice: [state.opening?.p0 ?? 0, state.opening?.p1 ?? 0].filter((d) => d > 0),
        }
      : draft.preview;

  // While the opponent's turn is being replayed, the board shows a PARTIAL
  // position built by the very same `previewDraft` that renders my own staged
  // turn — one code path, so the two can never disagree.
  const motion = useBoardMotion(state, mySeat, baseDisplay, motionOn);
  const displayState: GameState = { ...motion.display, dice: motion.dice };

  // Pip counts track what is DRAWN, not the authoritative state, so they tick
  // down alongside the checkers instead of jumping ahead of them.
  const myPip = useMemo(() => pipCount(displayState, me), [displayState, me]);
  const theirPip = useMemo(() => pipCount(displayState, them), [displayState, them]);

  return (
    <View style={styles.wrap}>
      {/*
        Strips, board and banner travel together as one block, centred in
        whatever height is left over. Letting them spread to the screen edges
        put the opponent's name a phone-length away from their checkers.
      */}
      <View style={styles.stack}>
        <PlayerStrip
          name={opponentName}
          seat={them}
          score={state.scores[them]}
          target={state.target}
          pip={theirPip}
          online={opponentOnline}
          active={state.turn === them && state.phase !== 'gameOver' && state.phase !== 'matchOver'}
          side="top"
        />

        <View style={styles.boardArea}>
          <BoardFrame
            m={m}
            state={displayState}
            mySeat={me}
            sources={draft.sources}
            selected={draft.selected}
            targets={draft.targets}
            spent={draft.spent}
            highlight={highlight}
            onTapPoint={tapPoint}
            onTapOff={draft.tapOff}
            onTapDice={mode === 'roll' ? doRoll : undefined}
            flying={
              motion.flying && motion.flyingSeat
                ? {
                    step: motion.flying,
                    seat: motion.flyingSeat,
                    mine: motion.flyingSeat === me,
                    hit: motion.flyingHit,
                  }
                : null
            }
          />
        </View>

        <PlayerStrip
          name={state.names[me] ?? 'You'}
          seat={me}
          score={state.scores[me]}
          target={state.target}
          pip={myPip}
          online
          active={myTurn && state.phase !== 'gameOver' && state.phase !== 'matchOver'}
          side="bottom"
        />

        <View style={styles.bannerRow}>
          <TurnBanner label={banner.label} tone={banner.tone} thinking={banner.thinking} />
        </View>

        {!connected && <Text style={styles.warn}>Reconnecting…</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.controls}>
        <MoveControls
          mode={mode}
          canUndo={draft.canUndo}
          canConfirm={draft.canConfirm}
          forcedPass={draft.forcedPass}
          busy={busy}
          onRoll={doRoll}
          onUndo={draft.undo}
          onUndoAll={draft.undoAll}
          onConfirm={doConfirm}
        />
      </View>

      <View style={styles.footer}>
        <Pressable onPress={() => setConfirmLeave(true)} style={styles.leave} hitSlop={8}>
          <Text style={styles.leaveText}>Leave game</Text>
        </Pressable>
        {onEmote && <EmoteTray onSend={onEmote} />}
      </View>

      <EmoteBubble
        emoji={opponentEmote?.emoji ?? null}
        n={opponentEmote?.n ?? null}
        side="top"
        enabled={motionOn}
      />
      <EmoteBubble
        emoji={myEmote?.emoji ?? null}
        n={myEmote?.n ?? null}
        side="bottom"
        enabled={motionOn}
      />

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {state.phase === 'gameOver' && state.gameResult && (
        <GameEndModal
          visible
          result={state.gameResult}
          names={state.names}
          mySeat={mySeat}
          target={state.target}
          busy={busy}
          requested={requestedNext}
          onNext={() => {
            setRequestedNext(true);
            void send({ kind: 'nextGame' });
          }}
          onLeave={onLeave}
        />
      )}

      {state.phase === 'matchOver' && state.matchResult && (
        <MatchEndModal
          visible
          match={state.matchResult}
          lastGame={state.gameResult}
          names={state.names}
          mySeat={mySeat}
          busy={busy}
          rematchVotes={rematchVotes}
          players={state.players}
          soloRematch={soloRematch}
          opponentGone={!soloRematch && !opponentOnline}
          onRematch={onRematch}
          onLeave={onLeave}
        />
      )}

      <ConfirmModal
        visible={confirmLeave}
        title="Leave the game?"
        body="Your opponent will be left waiting. You can rejoin with the room code."
        confirmLabel="Leave"
        onConfirm={() => {
          setConfirmLeave(false);
          onLeave();
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'stretch' },
  stack: { flex: 1, justifyContent: 'center' },
  boardArea: { alignItems: 'center', justifyContent: 'center' },
  bannerRow: { marginTop: 10, alignItems: 'center' },
  warn: { color: accent.warn, fontSize: 13, textAlign: 'center', marginTop: 6 },
  error: { color: accent.bad, fontSize: 13, textAlign: 'center', marginTop: 6 },
  controls: { marginTop: 'auto', paddingTop: 12 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
  },
  leave: { padding: 6 },
  leaveText: {
    color: text.faint,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
