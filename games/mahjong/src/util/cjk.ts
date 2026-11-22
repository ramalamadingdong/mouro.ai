/**
 * Whether this device has a font with the Chinese characters on the tiles.
 * Phones and desktops almost always do; some Linux machines do not, and the
 * tiles would show empty boxes. Checked once by drawing a tile character and
 * a character no font has, and comparing the pixels: identical means both
 * fell back to the "missing glyph" box. Outside a browser (tests), assume yes.
 */
export const GLYPH_FONT = "'Songti SC', 'STSong', 'Noto Serif CJK TC', 'Noto Serif CJK SC', 'Noto Sans CJK TC', 'PMingLiU', 'MingLiU', serif";

function detect(): boolean {
  try {
    if (typeof document === 'undefined') return true;
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    const draw = (ch: string): string => {
      ctx.clearRect(0, 0, 40, 40);
      ctx.font = `32px ${GLYPH_FONT}`;
      ctx.fillText(ch, 2, 34);
      return Array.from(ctx.getImageData(0, 0, 40, 40).data).join(',');
    };
    const missing = draw('\u{10FFFD}');
    return draw('萬') !== missing && draw('東') !== missing;
  } catch {
    return true;
  }
}

export const HAS_CJK = detect();
