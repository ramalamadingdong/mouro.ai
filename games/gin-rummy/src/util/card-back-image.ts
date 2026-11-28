/**
 * Card-back photo picker. Lets a player choose an image from their library to
 * use as the face-down card back. The photo is shown to the other player as
 * well (see gameStore's `setMyCardBack`), but it is only ever chosen here.
 *
 * Two steps, so the in-app cropper (components/photo-cropper.tsx) can sit
 * between them: `pickCardBackPhoto` gets the raw photo, then
 * `renderCardBack` crops the chosen rectangle out of it.
 *
 * Lives outside the engine because it imports Expo. We return a small JPEG
 * `data:` URI rather than the raw picked file: we downscale + compress so it
 * fits comfortably in AsyncStorage, and a self-contained `data:` string is the
 * only thing that survives an app reload on BOTH native and web (a picked
 * file / blob URI would not).
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'react-native';

/**
 * Longest edge of the stored image, in px. The largest a back ever renders at
 * is the ~66px draw overlay, so a few hundred px stays crisp on high-DPI while
 * keeping the persisted base64 small (well under AsyncStorage limits).
 */
const MAX_DIMENSION = 320;

/** Thrown when the user denies photo-library access. */
export class CardBackPickError extends Error {}

/** A picked photo at its full size, before cropping. */
export type PickedPhoto = { uri: string; width: number; height: number };

/** The part of a photo to keep, in the photo's own pixels. */
export type CropRect = { originX: number; originY: number; width: number; height: number };

function sizeOf(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

/**
 * Prompt for library permission and let the user pick an image. Resolves
 * `null` if the user cancels. Throws {@link CardBackPickError} if permission
 * is denied. No system crop step: the app's own cropper does that, the same
 * way on every platform (the web has no crop step, and iOS's is square only).
 */
export async function pickCardBackPhoto(): Promise<PickedPhoto | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new CardBackPickError(
      'Photo access is off — enable it in your settings to pick a card back.'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  let { width, height } = asset;
  if (!width || !height) ({ width, height } = await sizeOf(asset.uri));
  return { uri: asset.uri, width, height };
}

/**
 * Cut `crop` out of the photo, downscale it and return a JPEG `data:` URI
 * ready to persist.
 */
export async function renderCardBack(uri: string, crop: CropRect): Promise<string> {
  const resize =
    crop.width >= crop.height
      ? { width: Math.min(Math.round(crop.width), MAX_DIMENSION) }
      : { height: Math.min(Math.round(crop.height), MAX_DIMENSION) };

  const image = await ImageManipulator.manipulate(uri)
    .crop({
      originX: Math.round(crop.originX),
      originY: Math.round(crop.originY),
      width: Math.round(crop.width),
      height: Math.round(crop.height),
    })
    .resize(resize)
    .renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  if (out.base64) return `data:image/jpeg;base64,${out.base64}`;
  return out.uri;
}
