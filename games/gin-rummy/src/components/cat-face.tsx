/**
 * The computer cats' faces, drawn with plain Views (no SVG, no images) so it
 * works in Expo Go and scales to any size. It follows the SVG faces in Texas
 * Hold'em (games/holdem/src/components/avatar.tsx): same coats, same layout on
 * a 64-unit grid. The backgammon app keeps an identical copy of this file —
 * the apps are independent, so a change here should be made there too.
 */
import { memo } from 'react';
import { View, type ViewStyle } from 'react-native';

export type CatId = 'marmalade' | 'professor';

export type Coat = {
  fur: string;
  /** Inner ear and nose. */
  pink: string;
  eye: string;
  /** Tabby stripes, a shade darker than the fur. */
  stripe?: string;
  /** Tuxedo: white blaze and muzzle. */
  tuxedo?: boolean;
  glasses?: boolean;
};

export const COATS: Record<CatId, Coat> = {
  marmalade: { fur: '#e2913f', pink: '#f3b6a6', eye: '#5f8f3a', stripe: '#b4662a' },
  professor: { fur: '#2a282d', pink: '#e9a7a7', eye: '#7fb069', tuxedo: true, glasses: true },
};

/** An upward-pointing triangle, `w` wide and `h` tall, from CSS-style borders. */
function triangle(w: number, h: number, color: string): ViewStyle {
  return {
    width: 0,
    height: 0,
    borderLeftWidth: w / 2,
    borderRightWidth: w / 2,
    borderBottomWidth: h,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: color,
  };
}

function CatFaceBase({ cat, size }: { cat: CatId; size: number }) {
  const coat = COATS[cat];
  const k = size / 64; // one grid unit in px
  const at = (left: number, top: number, extra: ViewStyle = {}): ViewStyle => ({
    position: 'absolute',
    left: left * k,
    top: top * k,
    ...extra,
  });
  const oval = (cx: number, cy: number, rx: number, ry: number, color: string): ViewStyle =>
    at(cx - rx, cy - ry, {
      width: rx * 2 * k,
      height: ry * 2 * k,
      borderRadius: Math.max(rx, ry) * k,
      backgroundColor: color,
    });
  // A straight stroke from its centre, rotated; used for stripes and whiskers.
  const stroke = (cx: number, cy: number, len: number, weight: number, deg: number, color: string): ViewStyle =>
    at(cx - len / 2, cy - weight / 2, {
      width: len * k,
      height: weight * k,
      borderRadius: (weight / 2) * k,
      backgroundColor: color,
      transform: [{ rotate: `${deg}deg` }],
    });

  // Head ellipse: centre (32, 38), radii 24 x 20. Markings are drawn inside it
  // with coordinates relative to its top-left (8, 18) and clipped by it.
  const hx = 8;
  const hy = 18;
  const whisker = cat === 'professor' ? '#8d8894' : 'rgba(255,255,255,0.55)';

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden>
      {/* Ears, tipped outwards. */}
      <View style={at(9, 7, { ...triangle(18 * k, 22 * k, coat.fur), transform: [{ rotate: '-18deg' }] })} />
      <View style={at(37, 7, { ...triangle(18 * k, 22 * k, coat.fur), transform: [{ rotate: '18deg' }] })} />
      <View style={at(13.5, 13, { ...triangle(9 * k, 12 * k, coat.pink), transform: [{ rotate: '-18deg' }] })} />
      <View style={at(41.5, 13, { ...triangle(9 * k, 12 * k, coat.pink), transform: [{ rotate: '18deg' }] })} />

      <View style={[oval(32, 38, 24, 20, coat.fur), { overflow: 'hidden' }]}>
        {coat.stripe ? (
          <>
            <View style={stroke(26 - hx, 23.5 - hy, 7, 2.6, 90, coat.stripe)} />
            <View style={stroke(32 - hx, 22.5 - hy, 9, 2.6, 90, coat.stripe)} />
            <View style={stroke(38 - hx, 23.5 - hy, 7, 2.6, 90, coat.stripe)} />
            <View style={stroke(14.5 - hx, 35 - hy, 7, 2.6, 16, coat.stripe)} />
            <View style={stroke(14.5 - hx, 40.5 - hy, 7, 2.6, -8, coat.stripe)} />
            <View style={stroke(49.5 - hx, 35 - hy, 7, 2.6, -16, coat.stripe)} />
            <View style={stroke(49.5 - hx, 40.5 - hy, 7, 2.6, 8, coat.stripe)} />
          </>
        ) : null}
        {coat.tuxedo ? (
          <>
            <View style={at(29 - hx, 24 - hy, { width: 6 * k, height: 16 * k, borderRadius: 3 * k, backgroundColor: '#f6f1e7' })} />
            <View style={oval(32 - hx, 46 - hy, 11.5, 9, '#f6f1e7')} />
          </>
        ) : null}
      </View>

      {/* Eyes: coloured iris, slit pupil, a catch-light. */}
      <View style={oval(22.5, 36, 4.8, 5.4, coat.eye)} />
      <View style={oval(41.5, 36, 4.8, 5.4, coat.eye)} />
      <View style={oval(22.5, 36, 1.7, 4.4, '#141216')} />
      <View style={oval(41.5, 36, 1.7, 4.4, '#141216')} />
      <View style={oval(24, 34, 1.1, 1.1, '#fff')} />
      <View style={oval(43, 34, 1.1, 1.1, '#fff')} />

      {/* Nose: a downward triangle. */}
      <View style={at(29, 43.5, { ...triangle(6 * k, 3.6 * k, coat.pink), transform: [{ rotate: '180deg' }] })} />
      <View style={stroke(32, 48.3, 2.6, 1.3, 90, '#3a2b25')} />

      <View style={stroke(14, 45, 12, 0.9, 9, whisker)} />
      <View style={stroke(14.5, 49.2, 11, 0.9, -8, whisker)} />
      <View style={stroke(50, 45, 12, 0.9, -9, whisker)} />
      <View style={stroke(49.5, 49.2, 11, 0.9, 8, whisker)} />

      {coat.glasses ? (
        <>
          {[22.5, 41.5].map((cx) => (
            <View
              key={cx}
              style={at(cx - 7.2, 28.8, {
                width: 14.4 * k,
                height: 14.4 * k,
                borderRadius: 7.2 * k,
                borderWidth: 1.7 * k,
                borderColor: '#d9b45a',
                backgroundColor: 'rgba(255,255,255,0.12)',
              })}
            />
          ))}
          <View style={stroke(32, 36, 4.6, 1.7, 0, '#d9b45a')} />
        </>
      ) : null}
    </View>
  );
}

/** A computer cat's face, `size` px square. */
export const CatFace = memo(CatFaceBase);
