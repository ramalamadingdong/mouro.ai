import { StyleSheet, Text, View } from 'react-native';

import { CatFace, type CatId } from '@/components/cat-face';
import { accent, felt, piece, text } from '@/theme/colors';
import type { Seat } from '@/engine/types';

export type PlayerStripProps = {
  name: string;
  seat: Seat;
  score: number;
  target: number;
  pip: number;
  online: boolean;
  /** Draw the gold turn edge. */
  active: boolean;
  /** `top` sits above the board (the opponent), `bottom` below (you). */
  side: 'top' | 'bottom';
  /** Set when this player is a computer cat: draws its face by the name. */
  cat?: CatId;
};

/**
 * The name / colour / score / pip-count strip for one player. The pip count is
 * shown for both players on purpose — it is public information, everyone
 * serious counts it anyway, and hiding it just penalises beginners.
 */
export function PlayerStrip({
  name,
  seat,
  score,
  target,
  pip,
  online,
  active,
  side,
  cat,
}: PlayerStripProps) {
  return (
    <View
      style={[
        styles.bar,
        side === 'top' ? styles.top : styles.bottom,
        active && (side === 'top' ? styles.activeTop : styles.activeBottom),
      ]}
    >
      <View style={[styles.dot, { backgroundColor: online ? accent.online : accent.offline }]} />
      <View
        style={[
          styles.chip,
          {
            backgroundColor: seat === 'p0' ? piece.face : piece.back,
            borderColor: seat === 'p0' ? piece.faceEdge : piece.backAccent,
          },
        ]}
      />
      {cat ? <CatFace cat={cat} size={28} /> : null}
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.pip}>{pip} pips</Text>
      <Text style={styles.score}>
        {score}
        <Text style={styles.target}>/{target}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: felt.tableDeep,
    borderRadius: 8,
  },
  top: { marginBottom: 6 },
  bottom: { marginTop: 6 },
  activeTop: { borderBottomWidth: 3, borderBottomColor: accent.gold, paddingBottom: 5 },
  activeBottom: { borderTopWidth: 3, borderTopColor: accent.gold, paddingTop: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chip: { width: 14, height: 14, borderRadius: 7, borderWidth: 1 },
  name: { color: text.primary, fontSize: 14, fontWeight: '700', flex: 1 },
  pip: { color: text.hint, fontSize: 12 },
  score: { color: accent.gold, fontSize: 16, fontWeight: '800' },
  target: { color: text.faint, fontSize: 12, fontWeight: '600' },
});
