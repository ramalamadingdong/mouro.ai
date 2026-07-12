import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { meldKind, type CardId, type MatchKind, type Meld } from '@/engine';
import {
  SORT_LABELS,
  SORT_MODES,
  useHandSort,
  type SortMode,
} from '@/hooks/use-hand-sort';
import { accent, felt, meldColors, peek, text } from '@/theme/colors';

import { PlayingCard } from './playing-card';

export type HandProps = {
  /** The player's cards, in game-state (draw) order. */
  hand: CardId[];
  /** Currently staged card, matched by id so it survives re-sorting. */
  selected?: CardId | null;
  /** Tapping a card reports its id. */
  onSelect?: (card: CardId) => void;
  /** Initial sort mode (defaults to `off` = draw order). */
  initialSort?: SortMode;
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
  /** Press-and-hold a hand card to start a peek (reports the card's id). */
  onPeek?: (card: CardId) => void;
  /** Release ends the peek. */
  onPeekEnd?: () => void;
};

/**
 * The player's hand: a fanned row of cards plus a "Off / Rank / Suit" sort
 * toggle. Sorting only reorders the on-screen view — selection is tracked by
 * card id, so the staged card stays staged across a sort change.
 */
export function Hand({
  hand,
  selected,
  onSelect,
  initialSort = 'off',
  drawnCard = null,
  melds,
  peekCard = null,
  peekMatches = null,
  onPeek,
  onPeekEnd,
}: HandProps) {
  // The drawn card is held out separately; only the rest of the hand is sorted.
  const rest = useMemo(
    () => (drawnCard != null ? hand.filter((c) => c !== drawnCard) : hand),
    [hand, drawnCard],
  );
  const { mode, setMode, ordered } = useHandSort(rest, initialSort);
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
      <SortToggle mode={mode} onChange={setMode} />
      <View style={styles.row}>
        {ordered.map((c, i) => {
          const ms = meldStyleOf.get(c);
          const pk = peekStyle(c);
          return (
            <View key={c} style={i === 0 ? undefined : styles.overlap}>
              <PlayingCard
                card={c}
                selected={selected === c}
                meldColor={ms?.color ?? null}
                meldKind={ms?.kind ?? null}
                matchRing={pk.matchRing}
                dimmed={pk.dimmed}
                onPress={onSelect}
                onLongPress={onPeek}
                onPressOut={onPeekEnd}
              />
            </View>
          );
        })}
        {showDrawn ? (
          <View style={styles.drawnWrap}>
            <Text style={styles.drawnLabel}>new</Text>
            <PlayingCard
              card={drawnCard}
              selected={selected === drawnCard}
              meldColor={meldStyleOf.get(drawnCard)?.color ?? null}
              meldKind={meldStyleOf.get(drawnCard)?.kind ?? null}
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

function SortToggle({
  mode,
  onChange,
}: {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
}) {
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
    marginLeft: -22, // fan the cards so a 10-card hand fits on screen
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
    gap: 6,
    backgroundColor: felt.tableDeep,
    borderRadius: 999,
    padding: 4,
  },
  toggleLabel: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 6,
  },
  segment: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    overflow: 'hidden', // clip the pill background to the rounded corners
  },
  segmentActive: {
    color: text.onGold,
    backgroundColor: accent.gold,
  },
});
