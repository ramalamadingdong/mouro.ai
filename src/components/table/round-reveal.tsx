import { StyleSheet, Text, View } from 'react-native';

import { PlayingCard } from '@/components/playing-card';
import {
  cardToString,
  meldKind,
  otherSeat,
  type CardId,
  type Meld,
  type RoundResult,
  type RoundResultType,
  type Seat,
} from '@/engine';
import { accent, felt, meldColors, text } from '@/theme/colors';

/** Big headline label per result type. */
export const RESULT_LABELS: Record<RoundResultType, string> = {
  knock: 'Knock',
  gin: 'Gin',
  bigGin: 'Big Gin',
  undercut: 'Undercut',
  void: 'Void',
};

export type RoundRevealProps = {
  result: RoundResult;
  names: Record<Seat, string>;
  mySeat: Seat;
};

/**
 * Shared, dumb reveal of a finished round: WHO won and HOW. Renders the outcome
 * headline, a plain-English summary (including the card discarded to knock/gin),
 * each player's melds + deadwood (winner highlighted, labelled "Final hand"), the
 * knock-card pill, and a per-meld breakdown of the defender's layoffs. Pure — it
 * only reads its props. Meant to sit inside a parent ScrollView; supplies no
 * modal chrome or action buttons of its own.
 */
export function RoundReveal({ result, names, mySeat }: RoundRevealProps) {
  // Void: nothing to reveal — the round is redealt.
  if (result.type === 'void' || result.knocker == null || result.winner == null) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{RESULT_LABELS.void}</Text>
        <Text style={styles.voidText}>No game — redeal</Text>
      </View>
    );
  }

  const knocker = result.knocker;
  const defender = otherSeat(knocker);
  const winner = result.winner;
  const knockerRole =
    result.type === 'gin' || result.type === 'bigGin' ? 'Ginner' : 'Knocker';

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{RESULT_LABELS[result.type]}</Text>
      <Text style={styles.outcome}>
        {labelName(names, winner, mySeat)} wins +{result.points}
      </Text>
      <Text style={styles.summary}>{howSummary(result, names, mySeat)}</Text>

      <PlayerReveal
        role={knockerRole}
        name={labelName(names, knocker, mySeat)}
        melds={result.knockerMelds}
        deadwoodCards={result.knockerDeadwoodCards}
        deadwoodValue={result.deadwood[knocker]}
        isWinner={winner === knocker}
      />

      {result.knockCard != null && (
        <View style={styles.knockPill}>
          <PlayingCard card={result.knockCard} scale={1.1} />
          <View style={styles.knockPillText}>
            <Text style={styles.knockPillCaption}>{knockCaption(result.type)}</Text>
            <Text style={styles.knockPillCard}>{cardToString(result.knockCard)}</Text>
          </View>
        </View>
      )}

      <PlayerReveal
        role="Defender"
        name={labelName(names, defender, mySeat)}
        melds={result.defenderMelds}
        deadwoodCards={result.defenderDeadwoodCards}
        deadwoodValue={result.deadwood[defender]}
        isWinner={winner === defender}
      />

      {result.layoffs.length > 0 && (
        <LayoffSection
          result={result}
          defenderName={labelName(names, defender, mySeat)}
        />
      )}
    </View>
  );
}

/** "You" suffix for the local player's seat. */
function labelName(names: Record<Seat, string>, seat: Seat, mySeat: Seat): string {
  return seat === mySeat ? `${names[seat]} (you)` : names[seat];
}

/** One-line plain-English account of how the round was won. */
function howSummary(
  result: RoundResult,
  names: Record<Seat, string>,
  mySeat: Seat,
): string {
  const { type, knocker, winner, knockCard, deadwood } = result;
  if (knocker == null || winner == null) return '';
  const kc = knockCard != null ? cardToString(knockCard) : '';
  const kName = labelName(names, knocker, mySeat);
  const wName = labelName(names, winner, mySeat);
  switch (type) {
    case 'gin':
      return `${wName} went gin, discarding ${kc}`;
    case 'bigGin':
      return `${wName} hit Big Gin — melded all 11 cards, no discard`;
    case 'knock':
      return `${kName} knocked with ${deadwood[knocker]} deadwood, discarding ${kc}`;
    case 'undercut': {
      const defName = labelName(names, otherSeat(knocker), mySeat);
      return `${defName} undercut ${kName} (${kName} knocked discarding ${kc})`;
    }
    default:
      return '';
  }
}

/** Caption for the knock-card pill. */
function knockCaption(type: RoundResultType): string {
  switch (type) {
    case 'gin':
      return 'Discarded for gin';
    case 'undercut':
      return "Knocker's discard";
    default:
      return 'Discarded to knock';
  }
}

/** A single card cell in a strip, with its meld decoration. */
type Cell = {
  card: CardId;
  meldColor?: string | null;
  meldKind?: 'set' | 'run' | null;
  matchRing?: string | null;
};

/** A row of overlapping cards. Each cell carries its own meld/ring decoration. */
function CardStrip({ cells, dim }: { cells: Cell[]; dim?: boolean }) {
  return (
    <View style={[styles.cardRow, dim && styles.cardRowDim]}>
      {cells.map((cell, i) => (
        <View key={cell.card} style={i === 0 ? undefined : styles.cardOverlap}>
          <PlayingCard
            card={cell.card}
            meldColor={cell.meldColor}
            meldKind={cell.meldKind}
            matchRing={cell.matchRing}
          />
        </View>
      ))}
    </View>
  );
}

function PlayerReveal({
  role,
  name,
  melds,
  deadwoodCards,
  deadwoodValue,
  isWinner,
}: {
  role: string;
  name: string;
  melds: Meld[];
  deadwoodCards: CardId[];
  deadwoodValue: number;
  isWinner: boolean;
}) {
  return (
    <View style={[styles.player, isWinner && styles.playerWinner]}>
      <View style={styles.playerHeader}>
        <Text style={styles.playerRole}>{role}</Text>
        <Text style={styles.playerName} numberOfLines={1}>
          {name}
        </Text>
        <View
          style={[
            styles.deadwoodBadge,
            deadwoodValue === 0 && styles.deadwoodBadgeGin,
          ]}
        >
          <Text style={styles.deadwoodText}>
            {deadwoodValue === 0 ? 'GIN' : `Deadwood ${deadwoodValue}`}
          </Text>
        </View>
      </View>

      {isWinner && <Text style={styles.subLabel}>Final hand</Text>}

      {melds.map((meld, i) => {
        const color = meldColors[i % meldColors.length];
        const kind = meldKind(meld);
        return (
          <CardStrip
            key={`meld-${i}`}
            cells={meld.map((c) => ({ card: c, meldColor: color, meldKind: kind }))}
          />
        );
      })}

      {deadwoodCards.length > 0 && (
        <CardStrip cells={deadwoodCards.map((c) => ({ card: c }))} dim />
      )}
    </View>
  );
}

/**
 * Per-meld breakdown of the defender's layoffs. Each row shows a knocker meld
 * followed by the defender cards laid onto it (green-ringed), so it reads as the
 * meld being extended.
 */
function LayoffSection({
  result,
  defenderName,
}: {
  result: RoundResult;
  defenderName: string;
}) {
  // Group layoffs by the knocker meld they attach to, preserving order (which,
  // per the engine, is the order the cards extend the meld).
  const groups = new Map<number, CardId[]>();
  for (const { card, meldIndex } of result.layoffs) {
    const arr = groups.get(meldIndex);
    if (arr) arr.push(card);
    else groups.set(meldIndex, [card]);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Layoffs</Text>
      {[...groups.entries()].map(([meldIndex, laidCards]) => {
        const meld = result.knockerMelds[meldIndex];
        if (!meld) return null;
        const color = meldColors[meldIndex % meldColors.length];
        const kind = meldKind(meld);
        const cells: Cell[] = [
          ...meld.map((c) => ({ card: c, meldColor: color, meldKind: kind })),
          ...laidCards.map((c) => ({
            card: c,
            meldColor: color,
            meldKind: kind,
            matchRing: accent.good,
          })),
        ];
        return (
          <View key={`layoff-${meldIndex}`} style={styles.layoffGroup}>
            <CardStrip cells={cells} />
            <Text style={styles.layoffCaption}>
              {defenderName} laid off {laidCards.map(cardToString).join(', ')} onto{' '}
              {meld.map(cardToString).join(' ')}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
    paddingVertical: 4,
  },
  title: {
    color: accent.gold,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 1,
  },
  outcome: {
    color: text.primary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: -6,
  },
  summary: {
    color: text.muted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: -4,
  },
  voidText: {
    color: text.muted,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 24,
  },
  player: {
    backgroundColor: felt.table,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: felt.tableDeep,
  },
  playerWinner: {
    borderColor: accent.gold,
  },
  playerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerRole: {
    color: text.faint,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  playerName: {
    color: text.primary,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  subLabel: {
    color: accent.gold,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: -4,
  },
  deadwoodBadge: {
    backgroundColor: felt.tableDeep,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  deadwoodBadgeGin: {
    backgroundColor: accent.good,
  },
  deadwoodText: {
    color: text.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  knockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 12,
    backgroundColor: felt.tableDeep,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: accent.goldDim,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  knockPillText: {
    gap: 2,
  },
  knockPillCaption: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  knockPillCard: {
    color: text.primary,
    fontSize: 18,
    fontWeight: '800',
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  layoffGroup: {
    gap: 4,
  },
  layoffCaption: {
    color: text.hint,
    fontSize: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
  },
  cardRowDim: {
    opacity: 0.7,
  },
  cardOverlap: {
    marginLeft: -18,
  },
});
