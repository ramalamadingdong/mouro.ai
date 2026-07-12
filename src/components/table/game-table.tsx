/**
 * The shared in-game table — used by BOTH the online game screen and the solo
 * (vs computer) screen, so every table change applies to both. It owns all the
 * table UI and interaction logic (selection, hold-to-peek, meld highlighting,
 * the drawn-card-held-out, piles, action controls, draw animation, and the
 * round/match modals). The screens stay thin: they supply the game state and the
 * things that DIFFER between modes via props (where moves go, what "rematch"
 * means, opponent presence, the opponent-turn banner text).
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Hand } from '@/components/hand';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { DeadwoodBadge } from '@/components/table/deadwood-badge';
import { DiscardPile } from '@/components/table/discard-pile';
import { DrawFlyOverlay } from '@/components/table/draw-fly-overlay';
import { KnockButton, type KnockButtonLabel } from '@/components/table/knock-button';
import { MatchEndModal } from '@/components/table/match-end-modal';
import { OpponentBar } from '@/components/table/opponent-bar';
import { RoundEndModal } from '@/components/table/round-end-modal';
import { StockPile } from '@/components/table/stock-pile';
import { TurnBanner, type TurnBannerTone } from '@/components/table/turn-banner';
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
  /** Per-uid rematch votes for the match-end modal (solo: {}). */
  rematchVotes?: Record<string, boolean>;
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
  rematchVotes = {},
}: GameTableProps) {
  const sortMode = useSettingsStore((s) => s.sortMode);

  const [selected, setSelected] = useState<CardId | null>(null);
  // Hold-to-peek: the card being pressed-and-held (a hand card or the discard top).
  const [peekCard, setPeekCard] = useState<CardId | null>(null);

  // Selection/peek are local; a new authoritative state (any accepted move) clears them.
  useEffect(() => {
    setSelected(null);
    setPeekCard(null);
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
  const legal = useMemo(() => legalMoves(state, state.players[me]), [state, me]);
  const peekMatches = useMemo(
    () => (peekCard == null ? null : matchingCards(peekCard, myHand)),
    [peekCard, myHand],
  );

  const isMyTurn = state.turn === me && phase !== 'roundOver' && phase !== 'matchOver';
  const canAct = isMyTurn && !pending;
  const dw = arr.deadwoodValue;

  const discardTop =
    state.discard.length > 0 ? state.discard[state.discard.length - 1] : null;

  // The card just drawn this turn: the engine appends draws/takes to the end of
  // the hand, so during your own discard phase (11 cards) it's the last one.
  const drawnCard =
    phase === 'discard' && myHand.length === 11 ? myHand[myHand.length - 1] : null;

  const stockDrawable = canAct && legal.includes('drawStock');
  const discardDrawable = canAct && legal.includes('drawDiscard');
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
    if (phase === 'draw' && discardDrawable) {
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

  const knockLabel: KnockButtonLabel =
    selectedValidKnock && selectedDw === 0 ? 'GIN' : 'KNOCK';

  return (
    <Screen>
      <View style={styles.topRow}>
        <Pressable
          onPress={onLeave}
          accessibilityRole="button"
          accessibilityLabel="Leave game"
          style={({ pressed }) => [styles.leave, pressed && styles.leavePressed]}
        >
          <Text style={styles.leaveText}>‹ Leave</Text>
        </Pressable>
        <Text style={styles.roundLabel}>Round {state.round}</Text>
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
      />

      <View style={styles.center}>
        <View style={styles.pile}>
          <StockPile
            count={state.stock.length}
            drawable={stockDrawable}
            scale={PILE_SCALE}
            onPress={onDrawStock}
          />
          <Text style={styles.pileLabel}>Stock</Text>
        </View>
        <View style={styles.pile}>
          <DiscardPile
            top={discardTop}
            drawable={discardDrawable}
            isTarget={discardIsTarget}
            scale={PILE_SCALE}
            onPress={onDiscardPilePress}
            onLongPress={discardTop != null ? () => setPeekCard(discardTop) : undefined}
            onPressOut={onPeekEnd}
          />
          <Text style={styles.pileLabel}>Discard</Text>
        </View>
      </View>

      <TurnBanner text={bannerText} tone={bannerTone} />

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
          initialSort={sortMode}
          drawnCard={drawnCard}
          melds={arr.melds}
          peekCard={peekCard}
          peekMatches={peekMatches}
          onPeek={onPeek}
          onPeekEnd={onPeekEnd}
        />
      </View>

      <View style={styles.actionRow}>
        <DeadwoodBadge value={dw} highlight={canKnock || canBigGin} />
        <View style={styles.actionControls}>
          {isMyTurn && (phase === 'upcard1' || phase === 'upcard2') ? (
            <>
              <Button
                title="Take upcard"
                onPress={onTakeUpcard}
                disabled={pending}
                style={styles.upcardBtn}
              />
              <Button
                title="Pass"
                variant="secondary"
                onPress={onPassUpcard}
                disabled={pending}
                style={styles.upcardBtn}
              />
            </>
          ) : null}

          {isMyTurn && phase === 'draw' ? (
            <Text style={styles.hint}>Tap a pile to draw</Text>
          ) : null}

          {isMyTurn && phase === 'discard' ? (
            <View style={styles.discardControls}>
              {canBigGin ? (
                <KnockButton label="BIG GIN" onPress={onBigGin} disabled={pending} />
              ) : null}
              {canKnock ? (
                <KnockButton
                  label={knockLabel}
                  deadwood={selectedValidKnock ? selectedDw : undefined}
                  onPress={onKnock}
                  disabled={pending || !selectedValidKnock}
                />
              ) : null}
              {!canBigGin ? (
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

      <DrawFlyOverlay
        lastMove={state.lastMove}
        version={state.version}
        mySeat={me}
        names={state.names}
      />

      {state.roundResult ? (
        <RoundEndModal
          visible={phase === 'roundOver'}
          result={state.roundResult}
          names={state.names}
          mySeat={me}
          pending={pending}
          onNext={() => {
            void send({ kind: 'nextRound', seed: randomSeed() });
          }}
        />
      ) : null}

      {state.matchResult ? (
        <MatchEndModal
          visible={phase === 'matchOver'}
          result={state.matchResult}
          names={state.names}
          mySeat={me}
          players={state.players}
          rematchVotes={rematchVotes}
          pending={pending}
          onRematch={onRematch}
          onExit={onLeave}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  roundLabel: {
    color: text.faint,
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
    color: text.faint,
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
    color: text.faint,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
});
