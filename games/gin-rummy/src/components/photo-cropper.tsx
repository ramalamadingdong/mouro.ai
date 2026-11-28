/**
 * Crop and zoom a picked photo to the card's shape before it becomes the card
 * back. Drag to move; pinch, the slider or (on the web) the scroll wheel to
 * zoom. The photo always covers the card, so a back never has empty edges.
 *
 * The maths lives in util/crop-math.ts; this file is only the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

import { CARD_HEIGHT, CARD_WIDTH } from '@/components/playing-card';
import { Button } from '@/components/ui/button';
import { accent, felt, text } from '@/theme/colors';
import {
  clampOffset,
  coverScale,
  cropRect,
  MAX_ZOOM,
  MIN_ZOOM,
  zoomAround,
  type CropView,
  type Point,
} from '@/util/crop-math';
import type { CropRect, PickedPhoto } from '@/util/card-back-image';

/** Room around the card where the rest of the photo shows, dimmed. */
const MARGIN = 28;

export type PhotoCropperProps = {
  /** The photo to crop; `null` keeps the cropper closed. */
  photo: PickedPhoto | null;
  /** True while the chosen crop is being saved. */
  saving?: boolean;
  onCancel: () => void;
  onDone: (crop: CropRect) => void;
};

const START: CropView = { zoom: 1, offset: { x: 0, y: 0 } };

export function PhotoCropper({ photo, saving = false, onCancel, onDone }: PhotoCropperProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  // The card frame: as big as fits, keeping the card's own shape.
  const frameW = Math.round(
    Math.min(260, winW - 2 * MARGIN - 32, ((winH - 300) * CARD_WIDTH) / CARD_HEIGHT)
  );
  const frame = { width: Math.max(120, frameW), height: Math.max(120, frameW) * (CARD_HEIGHT / CARD_WIDTH) };
  const stage = { width: frame.width + 2 * MARGIN, height: frame.height + 2 * MARGIN };

  const [view, setViewState] = useState<CropView>(START);
  const viewRef = useRef(view);
  const setView = useCallback((next: CropView) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  // A new photo starts centred at the smallest zoom.
  useEffect(() => {
    if (photo) setView(START);
  }, [photo, setView]);

  // Latest sizes for the gesture callbacks, which are built once per render.
  const sizes = useRef({ photo, frame });
  sizes.current = { photo, frame };

  const moveStart = useRef<Point>({ x: 0, y: 0 });
  const pinchStart = useRef<{ view: CropView; focus: Point }>({ view: START, focus: { x: 0, y: 0 } });

  // Frame-centred position of a point given in stage coordinates.
  const fromStage = (x: number, y: number): Point => ({
    x: x - stage.width / 2,
    y: y - stage.height / 2,
  });

  const pan = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .onStart(() => {
      moveStart.current = viewRef.current.offset;
    })
    .onUpdate((e) => {
      const { photo: p, frame: f } = sizes.current;
      if (!p) return;
      const v = viewRef.current;
      setView({
        zoom: v.zoom,
        offset: clampOffset(p, f, v.zoom, {
          x: moveStart.current.x + e.translationX,
          y: moveStart.current.y + e.translationY,
        }),
      });
    });

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart((e) => {
      pinchStart.current = { view: viewRef.current, focus: fromStage(e.focalX, e.focalY) };
    })
    .onUpdate((e) => {
      const { photo: p, frame: f } = sizes.current;
      if (!p) return;
      const { view: from, focus } = pinchStart.current;
      setView(zoomAround(p, f, from, from.zoom * e.scale, focus));
    });

  const gestures = Gesture.Simultaneous(pan, pinch);

  // Scroll-wheel / trackpad zoom on the web. Added by hand so it can stop the
  // page behind the cropper from scrolling (React's wheel listener is passive).
  const stageRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !photo) return;
    const el = stageRef.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { photo: p, frame: f } = sizes.current;
      if (!p) return;
      const box = el.getBoundingClientRect();
      const focus = {
        x: e.clientX - box.left - box.width / 2,
        y: e.clientY - box.top - box.height / 2,
      };
      const v = viewRef.current;
      setView(zoomAround(p, f, v, v.zoom * Math.exp(-e.deltaY * 0.002), focus));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [photo, setView]);

  // Zoom slider.
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWRef.current = e.nativeEvent.layout.width;
    setTrackW(e.nativeEvent.layout.width);
  };
  const zoomTo = (x: number) => {
    const { photo: p, frame: f } = sizes.current;
    const w = trackWRef.current;
    if (!p || w <= 0) return;
    const t = Math.min(1, Math.max(0, x / w));
    setView(zoomAround(p, f, viewRef.current, MIN_ZOOM + t * (MAX_ZOOM - MIN_ZOOM)));
  };
  const slide = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => zoomTo(e.x))
    .onUpdate((e) => zoomTo(e.x));
  const nudge = (by: number) => {
    const p = sizes.current.photo;
    if (p) setView(zoomAround(p, frame, viewRef.current, viewRef.current.zoom + by));
  };

  if (!photo) return null;

  const scale = coverScale(photo, frame) * view.zoom;
  const imgW = photo.width * scale;
  const imgH = photo.height * scale;
  const thumbX = ((view.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * trackW;
  const radius = Math.round(frame.width * 0.12);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel}>
      <GestureHandlerRootView style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Crop your card back</Text>
          <Text style={styles.hint}>Drag to move · pinch or slide to zoom</Text>

          <GestureDetector gesture={gestures}>
            <View ref={stageRef} style={[styles.stage, stage]} collapsable={false}>
              <Image
                source={{ uri: photo.uri }}
                style={{
                  position: 'absolute',
                  width: imgW,
                  height: imgH,
                  left: stage.width / 2 + view.offset.x - imgW / 2,
                  top: stage.height / 2 + view.offset.y - imgH / 2,
                }}
                resizeMode="stretch"
              />
              {/* Dim everything outside the card. */}
              <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, right: 0, height: MARGIN }]} />
              <View pointerEvents="none" style={[styles.shade, { left: 0, bottom: 0, right: 0, height: MARGIN }]} />
              <View pointerEvents="none" style={[styles.shade, { left: 0, top: MARGIN, width: MARGIN, height: frame.height }]} />
              <View pointerEvents="none" style={[styles.shade, { right: 0, top: MARGIN, width: MARGIN, height: frame.height }]} />
              <View
                pointerEvents="none"
                style={[
                  styles.frame,
                  { left: MARGIN, top: MARGIN, width: frame.width, height: frame.height, borderRadius: radius },
                ]}
              />
            </View>
          </GestureDetector>

          <View style={styles.zoomRow}>
            <Text style={styles.zoomBtn} onPress={() => nudge(-0.5)} accessibilityRole="button" accessibilityLabel="Zoom out">
              −
            </Text>
            <GestureDetector gesture={slide}>
              <View
                style={styles.track}
                onLayout={onTrackLayout}
                accessibilityRole="adjustable"
                accessibilityLabel="Zoom"
                accessibilityValue={{ min: MIN_ZOOM, max: MAX_ZOOM, now: Math.round(view.zoom * 10) / 10 }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 0.5 : -0.5)}
              >
                <View style={styles.rail} />
                <View style={[styles.fill, { width: thumbX }]} />
                <View style={[styles.thumb, { left: thumbX - 11 }]} />
              </View>
            </GestureDetector>
            <Text style={styles.zoomBtn} onPress={() => nudge(0.5)} accessibilityRole="button" accessibilityLabel="Zoom in">
              +
            </Text>
          </View>

          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={saving} style={styles.action} />
            <Button
              title={saving ? 'Saving…' : 'Use photo'}
              onPress={() => onDone(cropRect(photo, frame, viewRef.current))}
              loading={saving}
              style={styles.action}
            />
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  sheet: {
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: felt.tableDeep,
    borderWidth: 1,
    borderColor: felt.tableGlow,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  title: {
    color: text.primary,
    fontSize: 18,
    fontWeight: '800',
  },
  hint: {
    color: text.hint,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  stage: {
    overflow: 'hidden',
    backgroundColor: '#000',
    borderRadius: 10,
    // Stop the browser from scrolling or zooming the page under a drag/pinch.
    ...(Platform.OS === 'web' ? ({ touchAction: 'none', cursor: 'grab', userSelect: 'none' } as object) : null),
  },
  shade: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  frame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: accent.gold,
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 14,
    gap: 10,
  },
  zoomBtn: {
    color: accent.gold,
    fontSize: 24,
    fontWeight: '800',
    width: 32,
    textAlign: 'center',
    lineHeight: 30,
  },
  track: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  rail: {
    height: 4,
    borderRadius: 2,
    backgroundColor: felt.tableGlow,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: accent.gold,
  },
  thumb: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: accent.gold,
  },
  actions: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 10,
    marginTop: 16,
  },
  action: {
    flex: 1,
  },
});
