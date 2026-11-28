import { useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { meldKind, type CardId, type MatchKind, type Meld } from '@/engine';
import { SORT_LABELS, SORT_MODES, moveCard, orderHand, type SortMode } from '@/hooks/use-hand-sort';
import { accent, felt, meldColors, peek, text } from '@/theme/colors';

import { AnimatedCard } from './animated-card';
import { CARD_WIDTH, type KnockHint } from './playing-card';

/** How far cards overlap in the fan, in px at scale 1. */
const OVERLAP = 22;

export type HandProps = {
  /** The player's cards, in game-state (draw) order. */
  hand: CardId[];
  /** Currently staged card, matched by id so it survives re-sorting. */
  selected?: CardId | null;
  /** Tapping a card reports its id. */
  onSelect?: (card: CardId) => void;
  /** Current sort mode (controlled — persisted by the caller). */
  sortMode: SortMode;
  /** Called when the player changes the sort mode via the toggle. */
  onSortChange: (mode: SortMode) => void;
  /** The player's own dragged order, used by the `custom` sort. */
  customOrder?: readonly CardId[];
  /**
   * Called with the new order when the player drags a card to a new place.
   * Leave out to turn dragging off.
   */
  onReorder?: (order: CardId[]) => void;
  /** Card size multiplier (grows the whole fan on tablets / large screens). */
  scale?: number;
  /** Ease cards in on mount (deal cascade / drawn card). Off = instant. */
  animate?: boolean;
  /**
   * The card just drawn this turn. It is held out separately at the end of the
   * hand (never sorted into the group) so you can see what you picked up before
   * deciding what to discard.
   */
  drawnCard?: CardId | null;
  /**
   * The best meld arrangement of the hand. Cards in the same meld get the same
   * underline color; runs are drawn with a solid bar and sets with a dashed bar,
   * so both the groupings and the meld kind are visible at a glance.
   */
  melds?: Meld[];
  /**
   * Hold-to-peek: the card currently being held (in hand or the discard). While
   * a card is held, cards in `peekMatches` ring (green = set, blue = run) and the
   * rest fade back, so you can see everything the held card could combine with.
   */
  peekCard?: CardId | null;
  /** Which hand cards match the held card, and how (set = rank, run = suit). */
  peekMatches?: Map<CardId, MatchKind> | null;
  /** Cards whose discard would enable a knock/gin — marked with a corner dot. */
  knockHints?: Map<CardId, KnockHint> | null;
  /** Press-and-hold a hand card to start a peek (reports the card's id). */
  onPeek?: (card: CardId) => void;
  /** Release ends the peek. */
  onPeekEnd?: () => void;
};

/**
 * The player's hand: a fanned row of cards plus an "Off / Rank / Suit / Meld /
 * Custom" sort toggle. Sorting only reorders the on-screen view — selection is
 * tracked by card id, so the staged card stays staged across a sort change.
 *
 * Drag a card sideways to move it; that saves the new order as the Custom sort.
 * While dragging, the card follows the finger and the others slide apart to
 * show where it will land. Nothing is re-ordered in the tree until the drop, so
 * the dragged view never moves under the pointer.
 */
export function Hand({
  hand,
  selected,
  onSelect,
  sortMode,
  onSortChange,
  customOrder,
  onReorder,
  scale = 1,
  animate = false,
  drawnCard = null,
  melds,
  peekCard = null,
  peekMatches = null,
  knockHints = null,
  onPeek,
  onPeekEnd,
}: HandProps) {
  // The drawn card is held out separately; only the rest of the hand is sorted.
  const rest = useMemo(
    () => (drawnCard != null ? hand.filter((c) => c !== drawnCard) : hand),
    [hand, drawnCard],
  );
  const ordered = useMemo(
    () => orderHand(rest, sortMode, melds, customOrder),
    [rest, sortMode, melds, customOrder],
  );

  // Drag to reorder. `from` is the card's index in `ordered`; `dx`/`dy` how far
  // it has moved. `step` is the distance between neighbouring cards.
  const [drag, setDrag] = useState<{
    from: number;
    dx: number;
    dy: number;
  } | null>(null);
  const step = (CARD_WIDTH - OVERLAP) * scale;
  const live = useRef({ ordered, step, onReorder, onPeekEnd });
  live.current = { ordered, step, onReorder, onPeekEnd };
  // A drag ends with the pointer still on the card, which a browser can count
  // as a tap; ignore taps straight after a drop so it doesn't select the card.
  const droppedAt = useRef(0);
  const select = onSelect
    ? (c: CardId) => {
        if (Date.now() - droppedAt.current > 300) onSelect(c);
      }
    : undefined;

  const targetOf = (from: number, dx: number, n: number) =>
    Math.max(0, Math.min(n - 1, from + Math.round(dx / live.current.step)));

  const dragEvents: DragEvents = {
    start: () => live.current.onPeekEnd?.(),
    move: (from, dx, dy) => setDrag({ from, dx, dy }),
    end: (from, dx) => {
      const { ordered: o, onReorder: reorder } = live.current;
      const to = targetOf(from, dx, o.length);
      if (to !== from) reorder?.(moveCard(o, from, to));
      droppedAt.current = Date.now();
      setDrag(null);
    },
  };
  const canDrag = onReorder != null && ordered.length > 1;

  // Where each card sits during a drag: the dragged one follows the pointer,
  // the ones it passes slide one place over.
  const dragTarget = drag ? targetOf(drag.from, drag.dx, ordered.length) : -1;
  const shiftOf = (i: number): { x: number; y: number } | null => {
    if (!drag) return null;
    if (i === drag.from) return { x: drag.dx, y: drag.dy };
    if (drag.from < i && i <= dragTarget) return { x: -step, y: 0 };
    if (dragTarget <= i && i < drag.from) return { x: step, y: 0 };
    return null;
  };
  const showDrawn = drawnCard != null && hand.includes(drawnCard);

  // Map every melded card to its group color (cycled per meld) and kind, so a
  // card can draw a solid (run) or dashed (set) underline in its group color.
  const meldStyleOf = useMemo(() => {
    const m = new Map<CardId, { color: string; kind: 'set' | 'run' }>();
    (melds ?? []).forEach((meld, i) => {
      const color = meldColors[i % meldColors.length];
      const kind = meldKind(meld);
      meld.forEach((c) => m.set(c, { color, kind }));
    });
    return m;
  }, [melds]);

  // While a card is held, ring the cards it matches and fade the rest. The held
  // card itself (when it's a hand card) stays bright and un-ringed.
  const peekStyle = (c: CardId): { matchRing: string | null; dimmed: boolean } => {
    if (!peekMatches) return { matchRing: null, dimmed: false };
    if (c === peekCard) return { matchRing: null, dimmed: false };
    const kind = peekMatches.get(c);
    if (kind) return { matchRing: kind === 'set' ? peek.set : peek.run, dimmed: false };
    return { matchRing: null, dimmed: true };
  };

  return (
    <View style={styles.container}>
      <SortToggle mode={sortMode} onChange={onSortChange} />
      <View style={[styles.row, scale !== 1 && { paddingTop: 12 * scale }]}>
        {ordered.map((c, i) => {
          const ms = meldStyleOf.get(c);
          const pk = peekStyle(c);
          const shift = shiftOf(i);
          const dragging = drag?.from === i;
          return (
            <DragSlot
              key={c}
              index={i}
              enabled={canDrag}
              events={dragEvents}
              style={[
                i === 0
                  ? undefined
                  : [styles.overlap, scale !== 1 && { marginLeft: -OVERLAP * scale }],
                shift && {
                  transform: [{ translateX: shift.x }, { translateY: shift.y }],
                },
                dragging && styles.dragging,
              ]}
            >
              <AnimatedCard
                animate={animate}
                delay={i * 25}
                card={c}
                selected={selected === c}
                meldColor={ms?.color ?? null}
                meldKind={ms?.kind ?? null}
                knockHint={knockHints?.get(c) ?? null}
                scale={scale}
                matchRing={pk.matchRing}
                dimmed={pk.dimmed}
                onPress={select}
                onLongPress={onPeek}
                onPressOut={onPeekEnd}
              />
            </DragSlot>
          );
        })}
        {showDrawn ? (
          <View style={[styles.drawnWrap, scale !== 1 && { marginLeft: 18 * scale }]}>
            <Text style={styles.drawnLabel}>new</Text>
            <AnimatedCard
              animate={animate}
              card={drawnCard}
              selected={selected === drawnCard}
              meldColor={meldStyleOf.get(drawnCard)?.color ?? null}
              meldKind={meldStyleOf.get(drawnCard)?.kind ?? null}
              knockHint={knockHints?.get(drawnCard) ?? null}
              scale={scale}
              matchRing={peekStyle(drawnCard).matchRing}
              dimmed={peekStyle(drawnCard).dimmed}
              onLongPress={onPeek}
              onPressOut={onPeekEnd}
              onPress={onSelect}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

type DragEvents = {
  start: () => void;
  move: (from: number, dx: number, dy: number) => void;
  end: (from: number, dx: number) => void;
};

/**
 * One card's place in the fan, draggable sideways. Built on RN's responder
 * system rather than gesture-handler so it can take the touch over from the
 * card's own Pressable once the finger moves: a still tap still selects, a
 * hold still peeks, and a sideways move becomes a drag. (A gesture-handler
 * pan swallowed the taps on the web.)
 */
function DragSlot({
  index,
  enabled,
  events,
  style,
  children,
}: {
  index: number;
  enabled: boolean;
  events: DragEvents;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const latest = useRef({ index, enabled, events });
  latest.current = { index, enabled, events };
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        latest.current.enabled && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latest.current.events.start(),
      onPanResponderMove: (_, g) => latest.current.events.move(latest.current.index, g.dx, g.dy),
      onPanResponderRelease: (_, g) => latest.current.events.end(latest.current.index, g.dx),
      onPanResponderTerminate: () => latest.current.events.end(latest.current.index, 0),
    }),
  ).current;
  return (
    <View style={style} {...responder.panHandlers}>
      {children}
    </View>
  );
}

function SortToggle({ mode, onChange }: { mode: SortMode; onChange: (mode: SortMode) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>Sort</Text>
      {SORT_MODES.map((m) => {
        const active = m === mode;
        return (
          <Text
            key={m}
            onPress={() => onChange(m)}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${SORT_LABELS[m]}`}
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            {SORT_LABELS[m]}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: 12, // headroom for a raised (selected) card
  },
  overlap: {
    marginLeft: -OVERLAP, // fan the cards so a 10-card hand fits on screen
  },
  dragging: {
    zIndex: 10, // ride above the neighbours it passes
    elevation: 10,
  },
  drawnWrap: {
    marginLeft: 18, // hold the just-drawn card out, apart from the fanned group
    alignItems: 'center',
  },
  drawnLabel: {
    color: accent.gold,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: felt.tableDeep,
    borderRadius: 999,
    padding: 4,
  },
  toggleLabel: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  segment: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 5,
    paddingHorizontal: 7, // five segments still fit a 320px-wide phone
    borderRadius: 999,
    overflow: 'hidden', // clip the pill background to the rounded corners
  },
  segmentActive: {
    color: text.onGold,
    backgroundColor: accent.gold,
  },
});
