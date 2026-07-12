import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PlayingCard } from '@/components/playing-card';
import {
  otherSeat,
  type CardId,
  type Meld,
  type RoundResult,
  type RoundResultType,
  type Seat,
} from '@/engine';
import { accent, card as cardColors, felt, text } from '@/theme/colors';

export type RoundEndModalProps = {
  visible: boolean;
  result: RoundResult;
  names: Record<Seat, string>;
  mySeat: Seat;
  onNext: () => void;
  pending?: boolean;
};

const RESULT_LABELS: Record<RoundResultType, string> = {
  knock: 'Knock',
  gin: 'Gin',
  bigGin: 'Big Gin',
  undercut: 'Undercut',
  void: 'Void',
};

/**
 * Round reveal overlay. DUMB: renders the finished `RoundResult` and reports the
 * "Next round" tap. Both hands are shown as melds + deadwood; the defender's
 * layoffs onto the knocker's melds are listed separately.
 */
export function RoundEndModal({
  visible,
  result,
  names,
  mySeat,
  onNext,
  pending,
}: RoundEndModalProps) {
  const isVoid = result.type === 'void';
  const knocker = result.knocker;
  const defender = knocker ? otherSeat(knocker) : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onNext}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{RESULT_LABELS[result.type]}</Text>

          {isVoid ? (
            <Text style={styles.voidText}>No game — redeal</Text>
          ) : (
            <>
              <Text style={styles.outcome}>
                {result.winner != null
                  ? `${labelName(names, result.winner, mySeat)} wins +${result.points}`
                  : 'No winner'}
              </Text>

              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator={false}
              >
                {knocker && (
                  <PlayerReveal
                    role={result.type === 'gin' || result.type === 'bigGin' ? 'Ginner' : 'Knocker'}
                    name={labelName(names, knocker, mySeat)}
                    melds={result.knockerMelds}
                    deadwoodCards={result.knockerDeadwoodCards}
                    deadwoodValue={result.deadwood[knocker]}
                    isWinner={result.winner === knocker}
                  />
                )}
                {defender && (
                  <PlayerReveal
                    role="Defender"
                    name={labelName(names, defender, mySeat)}
                    melds={result.defenderMelds}
                    deadwoodCards={result.defenderDeadwoodCards}
                    deadwoodValue={result.deadwood[defender]}
                    isWinner={result.winner === defender}
                  />
                )}

                {result.layoffs.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>Laid off</Text>
                    <CardRow cards={result.layoffs.map((l) => l.card)} />
                  </View>
                )}
              </ScrollView>
            </>
          )}

          <Pressable
            onPress={onNext}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel="Next round"
            accessibilityState={{ disabled: !!pending }}
            style={({ pressed }) => [
              styles.button,
              pending && styles.buttonDisabled,
              pressed && !pending && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonText}>
              {pending ? 'Dealing…' : 'Next round'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function labelName(
  names: Record<Seat, string>,
  seat: Seat,
  mySeat: Seat,
): string {
  return seat === mySeat ? `${names[seat]} (you)` : names[seat];
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

      {melds.map((meld, i) => (
        <View key={`meld-${i}`} style={styles.meldRow}>
          <CardRow cards={meld} />
        </View>
      ))}

      {deadwoodCards.length > 0 && (
        <View style={styles.deadwoodRow}>
          <CardRow cards={deadwoodCards} dim />
        </View>
      )}
    </View>
  );
}

function CardRow({ cards, dim }: { cards: CardId[]; dim?: boolean }) {
  return (
    <View style={[styles.cardRow, dim && styles.cardRowDim]}>
      {cards.map((c, i) => (
        <View key={c} style={i === 0 ? undefined : styles.cardOverlap}>
          <PlayingCard card={c} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90%',
    backgroundColor: felt.tableRaised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: accent.goldDim,
    padding: 20,
    gap: 12,
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
  },
  voidText: {
    color: text.muted,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 24,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    gap: 14,
    paddingVertical: 4,
  },
  section: {
    gap: 6,
  },
  sectionLabel: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  meldRow: {
    // grouped meld row
  },
  deadwoodRow: {
    marginTop: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  cardRowDim: {
    opacity: 0.7,
  },
  cardOverlap: {
    marginLeft: -18,
  },
  button: {
    backgroundColor: accent.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: accent.goldDim,
    opacity: 0.7,
  },
  buttonText: {
    color: text.onGold,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
