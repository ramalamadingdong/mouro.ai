/**
 * Pure maths behind the card-back cropper (components/photo-cropper.tsx).
 *
 * The photo sits behind a fixed frame. `zoom` 1 is the smallest size that
 * still covers the frame; `offset` is how far the photo's centre is from the
 * frame's centre, in screen px. Everything here keeps the frame covered, so a
 * crop never has empty edges.
 */

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type CropView = { zoom: number; offset: Point };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

/** Screen px per photo px at zoom 1: just big enough to cover the frame. */
export function coverScale(photo: Size, frame: Size): number {
  return Math.max(frame.width / photo.width, frame.height / photo.height);
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Keep the photo's edges outside the frame's edges. */
export function clampOffset(photo: Size, frame: Size, zoom: number, offset: Point): Point {
  const s = coverScale(photo, frame) * zoom;
  const maxX = Math.max(0, (photo.width * s - frame.width) / 2);
  const maxY = Math.max(0, (photo.height * s - frame.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

/**
 * Zoom to `nextZoom` while the photo point under `focus` (frame-centred
 * screen px; {0,0} is the frame's centre) stays put — pinch and wheel zoom
 * where the fingers or the pointer are.
 */
export function zoomAround(
  photo: Size,
  frame: Size,
  from: CropView,
  nextZoom: number,
  focus: Point = { x: 0, y: 0 }
): CropView {
  const zoom = clampZoom(nextZoom);
  const k = zoom / from.zoom;
  const offset = clampOffset(photo, frame, zoom, {
    x: focus.x - (focus.x - from.offset.x) * k,
    y: focus.y - (focus.y - from.offset.y) * k,
  });
  return { zoom, offset };
}

/** The rectangle of the photo inside the frame, in the photo's own px. */
export function cropRect(photo: Size, frame: Size, view: CropView) {
  const s = coverScale(photo, frame) * view.zoom;
  const width = Math.min(photo.width, frame.width / s);
  const height = Math.min(photo.height, frame.height / s);
  const originX = (photo.width * s - frame.width) / 2 / s - view.offset.x / s;
  const originY = (photo.height * s - frame.height) / 2 / s - view.offset.y / s;
  return {
    originX: Math.min(photo.width - width, Math.max(0, originX)),
    originY: Math.min(photo.height - height, Math.max(0, originY)),
    width,
    height,
  };
}
