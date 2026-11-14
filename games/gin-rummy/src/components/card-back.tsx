import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { CARD_WIDTH, CARD_HEIGHT } from '@/components/playing-card';
import { useSettingsStore } from '@/store/settingsStore';
import { card as cardColors } from '@/theme/colors';

export type CardBackProps = {
  /** Card width in px (defaults to the standard PlayingCard width). */
  width?: number;
  /** Card height in px (defaults to the standard PlayingCard height). */
  height?: number;
  /**
   * Explicit back image to render. Pass the OPPONENT's synced back here so their
   * face-down cards show THEIR photo, not this device's. Omit (`undefined`) to
   * use this device's own `customCardBack`; pass `null` to force the default
   * lattice regardless of local settings.
   */
  uri?: string | null;
};

function CardBackBase({ width = CARD_WIDTH, height = CARD_HEIGHT, uri }: CardBackProps) {
  const ownBack = useSettingsStore((s) => s.customCardBack);
  // `undefined` means "no override" → fall back to this device's own back.
  const customBack = uri === undefined ? ownBack : uri;
  const radius = Math.max(3, Math.round(width * 0.12));

  // A player's own photo, center-cropped to fill the card at any size. The
  // rounded/neutral frame + inset ring keep it reading as a card, not a sticker.
  if (customBack) {
    return (
      <View
        style={[styles.back, styles.photoBack, { width, height, borderRadius: radius }]}
        accessibilityElementsHidden
      >
        <Image
          source={{ uri: customBack }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <View
          style={[styles.photoInset, { borderRadius: Math.max(2, radius - 2) }]}
          pointerEvents="none"
        />
      </View>
    );
  }

  // A diamond-lattice woven from small rotated squares, sized off the card so it
  // scales with width (opponent fan 30px … draw overlay 66px). No images.
  const unit = Math.max(8, Math.round(width * 0.34));
  const cols = Math.ceil(width / unit);
  const rows = Math.ceil(height / unit);
  const cells = cols * rows;
  const diamond = Math.round(unit * 0.62);

  return (
    <View
      style={[styles.back, { width, height, borderRadius: radius }]}
      accessibilityElementsHidden
    >
      <View style={styles.lattice} pointerEvents="none">
        {Array.from({ length: cells }).map((_, i) => (
          <View key={i} style={{ width: unit, height: unit, alignItems: 'center', justifyContent: 'center' }}>
            <View style={[styles.diamond, { width: diamond, height: diamond }]} />
          </View>
        ))}
      </View>
      <View style={[styles.inset, { borderRadius: Math.max(2, radius - 3) }]} />
    </View>
  );
}

/** A single face-down playing card. Memoized — it only depends on its own props. */
export const CardBack = memo(CardBackBase);

const styles = StyleSheet.create({
  back: {
    backgroundColor: cardColors.back,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: cardColors.backAccent,
    overflow: 'hidden', // clip the lattice / photo to the rounded corners
  },
  photoBack: {
    // Neutral frame so an arbitrary photo doesn't clash with the felt-red back.
    backgroundColor: '#0d0d0d',
    borderColor: 'rgba(0,0,0,0.45)',
  },
  photoInset: {
    ...StyleSheet.absoluteFillObject,
    margin: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  lattice: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  diamond: {
    borderWidth: 1,
    borderColor: cardColors.backAccent,
    opacity: 0.55,
    transform: [{ rotate: '45deg' }],
  },
  inset: {
    ...StyleSheet.absoluteFillObject,
    margin: 4,
    borderWidth: 1.5,
    borderColor: cardColors.backAccent,
  },
});
