/**
 * The shared in-game table — used by BOTH the online game screen and the solo
 * (vs computer) screen, so every table change applies to both. It owns all the
 * table UI and interaction logic (selection, hold-to-peek, meld highlighting,
 * the drawn-card-held-out, piles, action controls, draw animation, and the
 * round/match modals). The screens stay thin: they supply the game state and the
 * things that DIFFER between modes via props (where moves go, what "rematch"
 * means, opponent presence, the opponent-turn banner text).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Hand } from '@/components/hand';
import { type KnockHint } from '@/components/playing-card';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ConfirmModal } from '@/components/table/confirm-modal';
import { DeadwoodBadge } from '@/components/table/deadwood-badge';
import { DiscardPile } from '@/components/table/discard-pile';
import { DrawFlyOverlay } from '@/components/table/draw-fly-overlay';
import { EmoteBubble } from '@/components/table/emote-bubble';
import { EmoteTray } from '@/components/table/emote-tray';
import { GrabToast } from '@/components/table/grab-toast';
import { KnockButton } from '@/components/table/knock-button';
import { MatchEndModal } from '@/components/table/match-end-modal';
import { OpponentBar } from '@/components/table/opponent-bar';
import { RoundEndModal } from '@/components/table/round-end-modal';
import { StockPile } from '@/components/table/stock-pile';
import { ThinkingDots } from '@/components/table/thinking-dots';
import { TurnBanner, type TurnBannerTone } from '@/components/table/turn-banner';
import { useElapsed } from '@/hooks/use-elapsed';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useResponsiveScale, TABLE_MAX_WIDTH } from '@/hooks/use-responsive-scale';
import {
  bestArrangement,
  knockOptions,
  legalMoves,
  matchingCards,
  otherSeat,
  type CardId,
  type GameState,
  type Move,
  type Seat,
} from '@/engine';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, felt, text } from '@/theme/colors';
import { randomSeed } from '@/util/seed';

/** How much bigger the stock/discard piles are than a hand card. */
const PILE_SCALE = 1.5;

/** Playful words shown when you snag the face-up discard/upcard. */
const GRAB_WORDS = ['Yoink', 'Yeet', 'Boink', 'Bink'] as const;

export type GameTableProps = {
  /** The authoritative game state (from Firebase online, or the local engine in solo). */
  state: GameState;
  /** The seat this device is playing. */
  mySeat: Seat;
  /** Submit a move (online: Firebase transaction; solo: local engine). */
  send: (move: Move) => void | Promise<void>;
  /** Leave the table (reset + navigate home). */
  onLeave: () => void;
  /** Start a rematch (online: vote; solo: deal a new match immediately). */
  onRematch: () => void;
  /** A move is in flight — disables controls. */
  pending?: boolean;
  /** Transient error banner. */
  error?: string | null;
  /** Self connection status (solo: always connected). Shows "Reconnecting…". */
  connected?: boolean;
  /** Opponent presence (solo: always online). Drives the dot + reconnecting label. */
  opponentOnline?: boolean;
  /** Banner text when it's the opponent's turn (solo: "Computer is thinking…"). */
  opponentTurnLabel?: string;
  /**
   * Whether the opponent is actively taking their turn — drives the "thinking…"
   * dots. Online: pass whether they're connected; solo: the CPU-thinking flag.
   */
  opponentThinking?: boolean;
  /** Per-uid rematch votes for the match-end modal (solo: {}). */
  rematchVotes?: Record<string, boolean>;
  /**
   * The opponent's chosen card-back photo (online only; solo leaves it null so
   * the CPU shows the default lattice). Shown on their face-down cards.
   */
  opponentCardBack?: string | null;
  /**
   * Broadcast a reaction. ONLINE ONLY — when omitted (solo), the whole reaction
   * UI (the tray button and the floating pops) is hidden.
   */
  onEmote?: (emoji: string) => void;
  /** This player's latest reaction, popped on my (bottom) side. */
  myEmote?: { emoji: string; n: number } | null;
  /** The opponent's latest reaction, popped on their (top) side. */
  opponentEmote?: { emoji: string; n: number } | null;
};

function impact() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
function success() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function GameTable({
  state,
  mySeat,
  send,
  onLeave,
  onRematch,
  pending = false,
  error = null,
  connected = true,
  opponentOnline = true,
  opponentTurnLabel = "Opponent's turn",
  opponentThinking = false,
  rematchVotes = {},
  opponentCardBack = null,
  onEmote,
  myEmote = null,
  opponentEmote = null,
}: GameTableProps) {
  const sortMode = useSettingsStore((s) => s.sortMode);
  const setSortMode = useSettingsStore((s) => s.setSortMode);
  const showKnockHints = useSettingsStore((s) => s.showKnockHints);
  const motion = useSettingsStore((s) => s.motion);
  const reducedMotion = useReducedMotion();
  const motionOn = motion && !reducedMotion;

  // Grow cards/piles on larger screens (tablets, desktop/web) for readability.
  const ui = useResponsiveScale();

  const [selected, setSelected] = useState<CardId | null>(null);
  // Hold-to-peek: the card being pressed-and-held (a hand card or the discard top).
  const [peekCard, setPeekCard] = useState<CardId | null>(null);
  // Leaving a live match asks for confirmation first (single-tap mis-taps abandon
  // the game otherwise). Round/match-over screens leave directly.
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Set when we've asked for the next round but the new deal hasn't arrived yet
  // (online latency, or the opponent hasn't advanced). Cleared on any new state.
  const [requestedNext, setRequestedNext] = useState(false);
  // The playful "Yoink!" pop shown to BOTH players when someone snags the
  // face-up discard/upcard. Driven off the authoritative move below, keyed by
  // version so the toast replays on each grab and both devices agree.
  const [grab, setGrab] = useState<{ word: string; key: number } | null>(null);

  // Selection/peek are local; a new authoritative state (any accepted move) clears them.
  useEffect(() => {
    setSelected(null);
    setPeekCard(null);
    setRequestedNext(false);
  }, [state.version]);

  const me = mySeat;
  const opp = otherSeat(me);
  const phase = state.phase;
  const myHand = state.hands[me];

  const arr = useMemo(() => bestArrangement(myHand), [myHand]);
  const knockMap = useMemo(() => {
    if (phase !== 'discard' || myHand.length !== 11) return new Map<CardId, number>();
    return new Map(knockOptions(myHand).map((o) => [o.card, o.deadwoodAfter]));
  }, [phase, myHand]);
  // Mark each discard that would enable a knock (green) or gin (gold). Reuses the
  // already-computed knockMap; only your own 11-card discard phase populates it.
  const knockHints = useMemo(() => {
    if (!showKnockHints || phase !== 'discard' || knockMap.size === 0) return null;
    const m = new Map<CardId, KnockHint>();
    for (const [c, dwAfter] of knockMap) {
      if (c === state.noDiscard) continue; // can't discard the just-taken card
      if (dwAfter === 0) m.set(c, 'gin');
      else if (dwAfter <= 10) m.set(c, 'knock');
    }
    return m.size > 0 ? m : null;
  }, [showKnockHints, phase, knockMap, state.noDiscard]);
  const legal = useMemo(() => legalMoves(state, state.players[me]), [state, me]);
  const peekMatches = useMemo(
    () => (peekCard == null ? null : matchingCards(peekCard, myHand)),
    [peekCard, myHand],
  );

  const isMyTurn = state.turn === me && phase !== 'roundOver' && phase !== 'matchOver';
  const canAct = isMyTurn && !pending;
  const dw = arr.deadwoodValue;

  // "Opponent is thinking" — only while it's genuinely their turn. A long idle
  // softens the copy. lastMove.at is a UI hint only; it never affects the game.
  const showThinking =
    opponentThinking && !isMyTurn && phase !== 'roundOver' && phase !== 'matchOver';
  const nowMs = useElapsed(showThinking);
  const lastMoveAt = state.lastMove?.at ?? 0;
  const stillDeciding = showThinking && lastMoveAt > 0 && nowMs - lastMoveAt >= 20000;

  const discardTop =
    state.discard.length > 0 ? state.discard[state.discard.length - 1] : null;

  // The middle deck wears the CURRENT player's card back: your own on your turn
  // (undefined → this device's back), the opponent's synced back on theirs.
  const stockBack = state.turn === me ? undefined : opponentCardBack;

  // The card just drawn this turn: the engine appends draws/takes to the end of
  // the hand, so during your own discard phase (11 cards) it's the last one.
  const drawnCard =
    phase === 'discard' && myHand.length === 11 ? myHand[myHand.length - 1] : null;

  const isUpcard = phase === 'upcard1' || phase === 'upcard2';
  const stockDrawable = canAct && legal.includes('drawStock');
  const discardDrawable = canAct && legal.includes('drawDiscard');
  // Upcard phase: tapping the upcard (the discard top) takes it — same gesture as
  // drawing from the discard, so the pile is the single, consistent draw surface.
  const canTakeUpcard = canAct && isUpcard && legal.includes('takeUpcard');
  const discardIsTarget =
    canAct && phase === 'discard' && selected != null && selected !== state.noDiscard;

  const canKnock = legal.includes('knock');
  const canBigGin = legal.includes('bigGin');
  const selectedDw = selected != null ? knockMap.get(selected) : undefined;
  const selectedValidKnock =
    selected != null &&
    selected !== state.noDiscard &&
    selectedDw !== undefined &&
    selectedDw <= 10;

  // The discard (if any) that leaves you at 0 deadwood — a gin. Found regardless
  // of which card you've selected, so gin is a single tap: you never have to hunt
  // for the exact card to throw. Big gin (all 11 meld) is its own action and
  // takes precedence, so we don't also offer a plain-gin discard there.
  const ginDiscard = useMemo<CardId | null>(() => {
    if (phase !== 'discard' || canBigGin) return null;
    for (const [c, dw] of knockMap) {
      if (dw === 0 && c !== state.noDiscard) return c;
    }
    return null;
  }, [phase, canBigGin, knockMap, state.noDiscard]);
  const canGin = ginDiscard !== null;

  let bannerText = opponentTurnLabel;
  let bannerTone: TurnBannerTone = 'wait';
  if (isMyTurn) {
    bannerTone = 'you';
    if (phase === 'upcard1' || phase === 'upcard2') {
      bannerText = 'Take the upcard or pass';
    } else if (phase === 'draw') {
      bannerText = 'Draw a card';
    } else if (phase === 'discard') {
      bannerText = canKnock || canBigGin ? 'Discard or knock' : 'Discard a card';
    }
  }

  const onDrawStock = () => {
    impact();
    void send({ kind: 'drawStock' });
  };
  const onDrawDiscard = () => {
    impact();
    void send({ kind: 'drawDiscard' });
  };
  const onDiscardPilePress = () => {
    if (canTakeUpcard) {
      onTakeUpcard();
    } else if (phase === 'draw' && discardDrawable) {
      onDrawDiscard();
    } else if (discardIsTarget && selected != null) {
      impact();
      void send({ kind: 'discard', card: selected });
    }
  };
  const onTakeUpcard = () => {
    impact();
    void send({ kind: 'takeUpcard' });
  };
  const onPassUpcard = () => {
    impact();
    void send({ kind: 'passUpcard' });
  };
  const onKnock = () => {
    if (selected == null || !selectedValidKnock) return;
    success();
    void send({ kind: 'knock', discard: selected });
  };
  // One tap to gin: auto-discards the card that leaves you at 0 deadwood.
  const onGin = () => {
    if (ginDiscard == null) return;
    success();
    void send({ kind: 'knock', discard: ginDiscard });
  };
  const onBigGin = () => {
    success();
    void send({ kind: 'bigGin' });
  };
  const onSelect = (c: CardId) => {
    setSelected((cur) => (cur === c ? null : c));
  };
  const onPeek = (c: CardId) => {
    impact();
    setPeekCard(c);
  };
  const onPeekEnd = () => setPeekCard(null);

  // Leaving mid-match confirms first; on the round/match-over screens leaving is
  // already expected, so go straight home.
  const requestLeave = () => {
    if (phase === 'roundOver' || phase === 'matchOver') onLeave();
    else setConfirmLeave(true);
  };

  // Show the playful "Yoink!" word to BOTH players whenever someone takes the
  // face-up card off the pile — a discard draw or upcard take, never a blind
  // stock draw. Driven off the authoritative lastMove/version (like the draw-fly
  // overlay) so it fires identically on both devices; the word is picked from
  // the version so both clients land on the same one.
  const grabbedVersion = useRef<number | null>(null);
  useEffect(() => {
    if (grabbedVersion.current === null) {
      grabbedVersion.current = state.version; // skip the state we mounted into
      return;
    }
    if (grabbedVersion.current === state.version) return;
    grabbedVersion.current = state.version;
    const lm = state.lastMove;
    if (!lm || (lm.kind !== 'drawDiscard' && lm.kind !== 'takeUpcard')) return;
    setGrab({ word: GRAB_WORDS[state.version % GRAB_WORDS.length], key: state.version });
    // Fire only when the authoritative version advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.version]);

  return (
    <Screen>
      <View style={styles.table}>
      <View style={styles.topRow}>
        <Pressable
          onPress={requestLeave}
          accessibilityRole="button"
          accessibilityLabel="Leave game"
          style={({ pressed }) => [styles.leave, pressed && styles.leavePressed]}
        >
          <Text style={styles.leaveText}>‹ Leave</Text>
        </Pressable>
        <View style={styles.topRight}>
          {onEmote ? <EmoteTray onEmote={onEmote} /> : null}
          <Text style={styles.roundLabel}>Round {state.round}</Text>
        </View>
      </View>

      {!connected ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Reconnecting…</Text>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.notice, styles.noticeError]}>
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      <OpponentBar
        name={state.names[opp]}
        handCount={state.hands[opp].length}
        score={state.scores[opp]}
        online={opponentOnline}
        isTurn={state.turn === opp && phase !== 'roundOver' && phase !== 'matchOver'}
        reconnecting={!opponentOnline}
        cardBack={opponentCardBack}
      />

      <View style={styles.center}>
        <View style={styles.pile}>
          <StockPile
            count={state.stock.length}
            drawable={stockDrawable}
            scale={PILE_SCALE * ui}
            onPress={onDrawStock}
            cardBack={stockBack}
          />
          <Text style={styles.pileLabel}>Stock</Text>
        </View>
        <View style={styles.pile}>
          <DiscardPile
            top={discardTop}
            drawable={discardDrawable || canTakeUpcard}
            isTarget={discardIsTarget}
            scale={PILE_SCALE * ui}
            onPress={onDiscardPilePress}
            onLongPress={discardTop != null ? () => setPeekCard(discardTop) : undefined}
            onPressOut={onPeekEnd}
          />
          <Text style={styles.pileLabel}>Discard</Text>
        </View>
      </View>

      <TurnBanner text={bannerText} tone={bannerTone} />

      {showThinking ? (
        <View style={styles.thinkingRow}>
          <ThinkingDots />
          {stillDeciding ? (
            <Text style={styles.thinkingHint}>still deciding…</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.selfBar}>
        <Text style={styles.selfName}>
          {state.names[me]} <Text style={styles.selfYou}>· you</Text>
        </Text>
        <Text style={styles.selfScore}>
          {state.scores[me]}
          <Text style={styles.selfTarget}> / {state.target}</Text>
        </Text>
      </View>

      <View style={styles.handArea}>
        <Hand
          hand={myHand}
          selected={selected}
          onSelect={canAct && phase === 'discard' ? onSelect : undefined}
          sortMode={sortMode}
          onSortChange={setSortMode}
          scale={ui}
          animate={motionOn}
          drawnCard={drawnCard}
          melds={arr.melds}
          peekCard={peekCard}
          peekMatches={peekMatches}
          knockHints={knockHints}
          onPeek={onPeek}
          onPeekEnd={onPeekEnd}
        />
      </View>

      <View style={styles.actionRow}>
        <DeadwoodBadge value={dw} highlight={canKnock || canBigGin} />
        <View style={styles.actionControls}>
          {isMyTurn && isUpcard ? (
            <View style={styles.discardControls}>
              <Text style={styles.hint}>Tap the upcard to take it</Text>
              <Button
                title="Pass"
                variant="secondary"
                onPress={onPassUpcard}
                disabled={pending}
                style={styles.upcardBtn}
              />
            </View>
          ) : null}

          {isMyTurn && phase === 'draw' ? (
            <Text style={styles.hint}>Tap a pile to draw</Text>
          ) : null}

          {isMyTurn && phase === 'discard' ? (
            <View style={styles.discardControls}>
              {canBigGin ? (
                <KnockButton label="BIG GIN" onPress={onBigGin} disabled={pending} />
              ) : null}
              {canGin ? (
                // One-tap GIN — always enabled when a gin is possible, no card
                // selection needed. It auto-discards the winning card for you.
                <KnockButton label="GIN" onPress={onGin} disabled={pending} />
              ) : null}
              {canKnock && !canGin ? (
                <KnockButton
                  label="KNOCK"
                  deadwood={selectedValidKnock ? selectedDw : undefined}
                  onPress={onKnock}
                  disabled={pending || !selectedValidKnock}
                />
              ) : null}
              {!canBigGin && !canGin ? (
                <Text style={styles.hint}>
                  {selected == null
                    ? 'Select a card to discard'
                    : selected === state.noDiscard
                      ? "Can't discard the card you just took"
                      : 'Tap the discard pile'}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      </View>

      <DrawFlyOverlay
        lastMove={state.lastMove}
        version={state.version}
        mySeat={me}
        names={state.names}
        sizeScale={ui}
        cardBack={opponentCardBack}
      />

      <GrabToast word={grab?.word ?? null} trigger={grab?.key ?? 0} />

      {onEmote ? (
        <>
          <EmoteBubble
            emoji={opponentEmote?.emoji ?? null}
            trigger={opponentEmote?.n ?? 0}
            anchor="top"
          />
          <EmoteBubble
            emoji={myEmote?.emoji ?? null}
            trigger={myEmote?.n ?? 0}
            anchor="bottom"
          />
        </>
      ) : null}


      {state.roundResult ? (
        <RoundEndModal
          visible={phase === 'roundOver'}
          result={state.roundResult}
          names={state.names}
          mySeat={me}
          pending={pending}
          waiting={requestedNext}
          onNext={() => {
            setRequestedNext(true);
            void send({ kind: 'nextRound', seed: randomSeed() });
          }}
        />
      ) : null}

      {state.matchResult && state.roundResult ? (
        <MatchEndModal
          visible={phase === 'matchOver'}
          result={state.matchResult}
          roundResult={state.roundResult}
          names={state.names}
          mySeat={me}
          players={state.players}
          rematchVotes={rematchVotes}
          opponentPresent={opponentOnline}
          pending={pending}
          onRematch={onRematch}
          onExit={onLeave}
        />
      ) : null}

      <ConfirmModal
        visible={confirmLeave}
        title="Leave the game?"
        message="This ends the game for you. You can't rejoin once you leave."
        confirmLabel="Leave"
        cancelLabel="Keep playing"
        onConfirm={() => {
          setConfirmLeave(false);
          onLeave();
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Centered, width-capped column so the table doesn't stretch awkwardly wide on
  // tablets / desktop; cards themselves grow via the responsive `ui` scale.
  table: {
    flex: 1,
    width: '100%',
    maxWidth: TABLE_MAX_WIDTH,
    alignSelf: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  leave: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  leavePressed: {
    opacity: 0.6,
  },
  leaveText: {
    color: text.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  roundLabel: {
    color: text.hint,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  notice: {
    backgroundColor: felt.tableDeep,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: accent.goldDim,
  },
  noticeError: {
    borderColor: accent.bad,
  },
  noticeText: {
    color: text.primary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  center: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 44,
    flex: 1,
    paddingVertical: 12,
  },
  pile: {
    alignItems: 'center',
    gap: 8,
  },
  pileLabel: {
    color: text.muted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  thinkingHint: {
    color: text.hint,
    fontSize: 12,
    fontWeight: '600',
  },
  selfBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  selfName: {
    color: text.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  selfYou: {
    color: accent.gold,
    fontWeight: '700',
  },
  selfScore: {
    color: accent.gold,
    fontSize: 18,
    fontWeight: '800',
  },
  selfTarget: {
    color: text.hint,
    fontSize: 13,
    fontWeight: '600',
  },
  handArea: {
    alignItems: 'center',
    marginTop: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
    minHeight: 56,
  },
  actionControls: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  upcardBtn: {
    paddingHorizontal: 16,
  },
  discardControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  hint: {
    color: text.hint,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
});
