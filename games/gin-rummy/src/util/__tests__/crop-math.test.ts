import { clampOffset, cropRect, zoomAround } from '../crop-math';

const frame = { width: 240, height: 340 };
const wide = { width: 4000, height: 3000 };
const tall = { width: 1000, height: 3000 };

describe('cropRect', () => {
  it('takes the centred, full-height slice of a wide photo at zoom 1', () => {
    const r = cropRect(wide, frame, { zoom: 1, offset: { x: 0, y: 0 } });
    expect(r.height).toBeCloseTo(3000);
    expect(r.width).toBeCloseTo((3000 * 240) / 340);
    expect(r.originX + r.width / 2).toBeCloseTo(2000);
    expect(r.originY).toBeCloseTo(0);
  });

  it('keeps the card shape', () => {
    const r = cropRect(tall, frame, { zoom: 2.3, offset: { x: 10, y: -40 } });
    expect(r.width / r.height).toBeCloseTo(240 / 340);
  });

  it('halves the slice at zoom 2', () => {
    const one = cropRect(wide, frame, { zoom: 1, offset: { x: 0, y: 0 } });
    const two = cropRect(wide, frame, { zoom: 2, offset: { x: 0, y: 0 } });
    expect(two.width).toBeCloseTo(one.width / 2);
  });

  it('moving the photo right shows more of its left side', () => {
    const r = cropRect(wide, frame, { zoom: 1, offset: { x: 50, y: 0 } });
    expect(r.originX + r.width / 2).toBeLessThan(2000);
  });

  it('never leaves the photo', () => {
    const off = clampOffset(wide, frame, 1, { x: 99999, y: 99999 });
    const r = cropRect(wide, frame, { zoom: 1, offset: off });
    expect(r.originX).toBeCloseTo(0);
    expect(r.originY).toBeCloseTo(0);
  });
});

describe('zoomAround', () => {
  it('keeps the point under the fingers still', () => {
    const from = { zoom: 1, offset: { x: 0, y: 0 } };
    const focus = { x: 30, y: 40 };
    const to = zoomAround(tall, frame, from, 2, focus);
    // The photo point under `focus` before and after, in photo px.
    const before = cropRect(tall, frame, from);
    const after = cropRect(tall, frame, to);
    const at = (r: typeof before) => ({
      x: r.originX + ((focus.x + frame.width / 2) / frame.width) * r.width,
      y: r.originY + ((focus.y + frame.height / 2) / frame.height) * r.height,
    });
    expect(at(after).x).toBeCloseTo(at(before).x);
    expect(at(after).y).toBeCloseTo(at(before).y);
  });

  it('stays between 1x and 5x', () => {
    const from = { zoom: 1, offset: { x: 0, y: 0 } };
    expect(zoomAround(wide, frame, from, 0.2).zoom).toBe(1);
    expect(zoomAround(wide, frame, from, 50).zoom).toBe(5);
  });
});
