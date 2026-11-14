import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BAR, CHECKERS, OFF, otherSeat, ownAt } from '@/engine/board';

const MAX_STACK_DRAWN = 8; // matches BoardMetrics.drawn()
import type { GameState, Seat, Step } from '@/engine/types';
import { Checker } from '@/components/board/checker';
import { CheckerFlyOverlay } from '@/components/board/checker-fly-overlay';
import { Die } from '@/components/board/die';
import type { BoardMetrics } from '@/hooks/use-board-metrics';
import { accent, board, felt, piece, text } from '@/theme/colors';

export type BoardFrameProps = {
  m: BoardMetrics;
  /** The state to DRAW — usually the draft preview, not the authoritative one. */
  state: GameState;
  /** Whose frame to draw in. Null (spectating) falls back to p0. */
  mySeat: Seat | null;
  /** Points a checker can currently be picked up from. */
  sources: number[];
  /** The point currently picked up, if any. */
  selected: number | null;
  /** Legal destinations from `selected`. */
  targets: Step[];
  /** Die values already spent by the staged turn. */
  spent: number[];
  /** Ring legal destinations (a user setting). */
  highlight: boolean;
  onTapPoint: (own: number) => void;
  onTapOff: () => void;
  onTapDice?: () => void;
  /** A checker in flight during the opponent's turn replay. */
  flying?: { step: Step; seat: Seat; mine: boolean; hit: boolean } | null;
};

/**
 * The board, drawn.
 *
 * Everything is absolutely positioned from `BoardMetrics`, and every visual
 * layer is `pointerEvents="none"`. Taps are handled by a single layer of
 * transparent targets on top, so the hit areas are the full ptW x triH columns
 * rather than the 20px checkers — a decision worth keeping: a 23x120 target is
 * comfortable, a 20px circle is not.
 */
export function BoardFrame({
  m,
  state,
  mySeat,
  sources,
  selected,
  targets,
  spent,
  highlight,
  onTapPoint,
  onTapOff,
  onTapDice,
  flying = null,
}: BoardFrameProps) {
  const me: Seat = mySeat ?? 'p0';
  const them = otherSeat(me);
  const inlay = Math.max(2, 2 * m.scale);

  const targetSet = new Set(targets.map((s) => s.to));
  const sourceSet = new Set(sources);

  // ── Dice faces, and which of them the staged turn has already used ─────────
  const faces: number[] =
    state.dice.length === 2 && state.dice[0] === state.dice[1]
      ? [state.dice[0], state.dice[0], state.dice[0], state.dice[0]]
      : state.dice.slice();
  const used = new Array<boolean>(faces.length).fill(false);
  for (const v of spent) {
    const i = faces.findIndex((f, k) => f === v && !used[k]);
    if (i >= 0) used[i] = true;
  }

  // The checker in flight, translated into MY frame. `flying.step` is in the
  // MOVER's own frame; for the opponent that is the mirror image of mine, and
  // drawing it untranslated made every opponent move appear to fly between the
  // wrong points on the wrong side of the board.
  const flight = (() => {
    if (!flying) return null;
    const mirror = (i: number) => (flying.mine || i === BAR || i === OFF ? i : 23 - i);
    const from = mirror(flying.step.from);
    const to = mirror(flying.step.to);
    // Lift from the top of the source stack, land on top of the destination.
    const fromCount = from === BAR ? 1 : Math.max(1, Math.abs(ownAt(state.points, me, from)));
    const toCount = to === OFF ? 0 : flying.hit ? 0 : Math.abs(ownAt(state.points, me, to));
    return { from, to, fromK: Math.min(fromCount, MAX_STACK_DRAWN) - 1, fromCount, toK: Math.min(toCount, MAX_STACK_DRAWN - 1), toCount: toCount + 1 };
  })();

  return (
    /*
     * The frame is sized boardW + 2*inlay on purpose. React Native puts a
     * border INSIDE the box, so a bordered View of exactly boardW x boardH has
     * a content box that is 2*inlay smaller — and since every child here is
     * absolutely positioned in [0, boardW] x [0, boardH] from `BoardMetrics`,
     * the bottom row of checkers and the cube ended up clipped by the frame.
     * Growing the outer box keeps the metrics honest.
     */
    <View
      style={[
        styles.outer,
        { width: m.boardW + inlay * 2, height: m.boardH + inlay * 2, borderWidth: inlay },
      ]}
    >
      {/* Play field */}
      <View
        pointerEvents="none"
        style={[styles.field, { left: m.fieldX, width: m.fieldW, height: m.boardH }]}
      />
      {/* Bar */}
      <View
        pointerEvents="none"
        style={[styles.bar, { left: m.barX, width: m.barW, height: m.boardH }]}
      />
      {/* Tray rail (left edge, beside the home board) */}
      <View
        pointerEvents="none"
        style={[styles.rail, { left: m.railX, width: m.railW, height: m.boardH }]}
      />

      {/* ── Points ─────────────────────────────────────────────────────────── */}
      {Array.from({ length: 24 }, (_, own) => {
        const g = m.pointXY(own);
        const light = own % 2 === 0;
        const isTarget = highlight && targetSet.has(own);
        const isSelected = selected === own;
        const colour = isSelected
          ? accent.gold
          : isTarget
            ? accent.goldDim
            : light
              ? board.pointLight
              : board.pointDark;
        return (
          <View
            key={`pt${own}`}
            pointerEvents="none"
            style={{ position: 'absolute', left: g.x, top: g.y, width: m.ptW, height: m.triH }}
          >
            <View
              style={{
                width: 0,
                height: 0,
                borderLeftWidth: m.ptW / 2,
                borderRightWidth: m.ptW / 2,
                borderLeftColor: 'transparent',
                borderRightColor: 'transparent',
                ...(g.up
                  ? { borderBottomWidth: m.triH, borderBottomColor: colour }
                  : { borderTopWidth: m.triH, borderTopColor: colour }),
                ...(g.up ? { marginTop: 0 } : {}),
              }}
            />
          </View>
        );
      })}

      {/* ── Checkers on points ─────────────────────────────────────────────── */}
      {Array.from({ length: 24 }, (_, own) => {
        const v = ownAt(state.points, me, own);
        if (v === 0) return null;
        const seat = v > 0 ? me : them;
        const count = Math.abs(v);
        const show = m.drawn(count);
        return (
          <Fragment key={`ck${own}`}>
            {Array.from({ length: show }, (_, k) => {
              const p = m.checkerXY(own, k, count);
              const outermost = k === show - 1;
              return (
                <Checker
                  key={k}
                  seat={seat}
                  size={m.ch}
                  x={p.x}
                  y={p.y}
                  badge={outermost && count > show ? count : undefined}
                  ringed={selected === own && outermost}
                />
              );
            })}
          </Fragment>
        );
      })}

      {/* ── Ghost checkers on legal destinations ───────────────────────────── */}
      {highlight &&
        targets
          .filter((s) => s.to !== OFF)
          .map((s) => {
            const existing = Math.abs(ownAt(state.points, me, s.to));
            const p = m.checkerXY(s.to, existing, existing + 1);
            return <Checker key={`gh${s.to}`} seat={me} size={m.ch} x={p.x} y={p.y} ghost />;
          })}

      {/* ── Bar ────────────────────────────────────────────────────────────── */}
      {Array.from({ length: Math.min(state.bar[me], 5) }, (_, k) => {
        const p = m.barXY(true, k);
        return (
          <Checker
            key={`bm${k}`}
            seat={me}
            size={m.ch}
            x={p.x}
            y={p.y}
            badge={k === 4 && state.bar[me] > 5 ? state.bar[me] : undefined}
            ringed={selected === BAR && k === 0}
          />
        );
      })}
      {Array.from({ length: Math.min(state.bar[them], 5) }, (_, k) => {
        const p = m.barXY(false, k);
        return (
          <Checker
            key={`bt${k}`}
            seat={them}
            size={m.ch}
            x={p.x}
            y={p.y}
            badge={k === 4 && state.bar[them] > 5 ? state.bar[them] : undefined}
          />
        );
      })}

      {/* ── Bear-off trays: checkers seen edge-on, as on a real board ───────── */}
      {(['mine', 'theirs'] as const).map((which) => {
        const mine = which === 'mine';
        const seat = mine ? me : them;
        const n = state.off[seat];
        return (
          <Fragment key={`tray${which}`}>
            {Array.from({ length: Math.min(n, CHECKERS) }, (_, k) => {
              const p = m.trayXY(mine, k);
              return (
                <View
                  key={k}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: p.x,
                    top: p.y,
                    width: m.railW - 6 * m.scale,
                    height: Math.max(2, m.trayBarH - 1),
                    borderRadius: 1,
                    backgroundColor: seat === 'p0' ? piece.face : piece.back,
                  }}
                />
              );
            })}
            {n > 0 && (
              <Text
                pointerEvents="none"
                style={[
                  styles.trayCount,
                  {
                    left: m.railX,
                    width: m.railW,
                    fontSize: 9 * m.scale,
                    [mine ? 'bottom' : 'top']: m.trayBarH * 15 + 9 * m.scale,
                  },
                ]}
              >
                {n}
              </Text>
            )}
          </Fragment>
        );
      })}

      {/* ── Dice ───────────────────────────────────────────────────────────── */}
      {faces.map((f, i) => {
        const p = m.dieXY(i, faces.length);
        return <Die key={`d${i}`} value={f} size={m.dieSize} x={p.x} y={p.y} used={used[i]} />;
      })}

      {/* ── The checker currently in flight ────────────────────────────────── */}
      {flying && (
        <CheckerFlyOverlay
          key={`${flying.step.from}-${flying.step.to}`}
          m={m}
          flight={flight!}
          seat={flying.seat}
          mine={flying.mine}
          hit={flying.hit}
        />
      )}

      {/* ── Tap targets, on top of everything ──────────────────────────────── */}
      {Array.from({ length: 24 }, (_, own) => {
        const g = m.pointXY(own);
        return (
          <Pressable
            key={`hit${own}`}
            onPress={() => onTapPoint(own)}
            accessibilityRole="button"
            accessibilityLabel={`Point ${own + 1}`}
            style={{ position: 'absolute', left: g.x, top: g.y, width: m.ptW, height: m.triH }}
          />
        );
      })}
      <Pressable
        onPress={() => onTapPoint(BAR)}
        accessibilityRole="button"
        accessibilityLabel="Bar"
        style={{ position: 'absolute', left: m.barX, top: m.midY - m.triH / 2, width: m.barW, height: m.triH }}
      />
      <Pressable
        onPress={onTapOff}
        accessibilityRole="button"
        accessibilityLabel="Bear off"
        style={{
          position: 'absolute',
          left: m.railX,
          top: m.boardH / 2,
          width: m.railW,
          height: m.boardH / 2,
        }}
      />
      {onTapDice && (
        <Pressable
          onPress={onTapDice}
          accessibilityRole="button"
          accessibilityLabel="Roll"
          style={{
            position: 'absolute',
            left: m.barX + m.barW,
            top: m.triH,
            width: m.ptW * 6,
            height: m.midH,
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'relative',
    backgroundColor: board.frame,
    borderColor: board.inlay,
    borderRadius: 6,
    overflow: 'hidden',
  },
  field: { position: 'absolute', top: 0, backgroundColor: board.field },
  bar: { position: 'absolute', top: 0, backgroundColor: felt.tableDeep },
  rail: { position: 'absolute', top: 0, backgroundColor: felt.tableDeep },
  trayCount: {
    position: 'absolute',
    color: text.hint,
    fontWeight: '800',
    textAlign: 'center',
  },
});
