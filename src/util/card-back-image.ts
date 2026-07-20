/**
 * Card-back photo picker. Lets a player choose an image from their library to
 * use as the face-down card back — a LOCAL, personal cosmetic that is never
 * synced (each player sees their own backs).
 *
 * Lives outside the engine because it imports Expo. We return a small JPEG
 * `data:` URI rather than the raw picked file: we downscale + compress so it
 * fits comfortably in AsyncStorage, and a self-contained `data:` string is the
 * only thing that survives an app reload on BOTH native and web (a picked
 * file / blob URI would not).
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { CARD_HEIGHT, CARD_WIDTH } from '@/components/playing-card';

/**
 * Longest edge of the stored image, in px. The largest a back ever renders at
 * is the ~66px draw overlay, so a few hundred px stays crisp on high-DPI while
 * keeping the persisted base64 small (well under AsyncStorage limits).
 */
const MAX_DIMENSION = 320;

/** Thrown when the user denies photo-library access. */
export class CardBackPickError extends Error {}

/**
 * Prompt for library permission, let the user pick + crop an image, then return
 * a downscaled JPEG `data:` URI ready to persist. Resolves `null` if the user
 * cancels. Throws {@link CardBackPickError} if permission is denied.
 */
export async function pickCardBackImage(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new CardBackPickError(
      'Photo access is off — enable it in your settings to pick a card back.'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: true,
    // Android crops to the card shape; iOS forces a square crop, which we then
    // center-fill with `contentFit="cover"` when rendering the back.
    aspect: [CARD_WIDTH, CARD_HEIGHT],
    quality: 1,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];

  // Downscale the longest edge; the other dimension follows to keep the ratio.
  const w = asset.width || MAX_DIMENSION;
  const h = asset.height || MAX_DIMENSION;
  const resize =
    w >= h
      ? { width: Math.min(w, MAX_DIMENSION) }
      : { height: Math.min(h, MAX_DIMENSION) };

  try {
    const image = await ImageManipulator.manipulate(asset.uri).resize(resize).renderAsync();
    const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
    if (out.base64) return `data:image/jpeg;base64,${out.base64}`;
    return out.uri;
  } catch {
    // Manipulation is rare to fail; fall back to the raw picked image so the
    // feature still works (slightly larger, but the crop/pick already happened).
    return asset.uri;
  }
}
