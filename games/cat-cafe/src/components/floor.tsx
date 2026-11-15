/**
 * A café floor. Draws one seat's cats from its floor string; optionally a
 * "ghost" (the cat being aimed) on top. Children ignore the pointer, so every
 * pointer event's target is the <svg> itself and survives the redraws.
 */
import { memo, useMemo, type PointerEventHandler, type Ref } from 'react';
import { parseFloor, type Cell, type Coat } from '@/engine';
import { floorMarkup, ghostMarkup } from '@/components/draw';
import './floor.css';

export interface FloorProps {
  /** The seat's floor string from the state. */
  floor: string;
  label: string;
  /** Index of the cat that just arrived, to animate in. */
  fresh?: number;
  ghost?: { cells: Cell[]; coat: Coat; ok: boolean } | null;
  /** True while a cat is held: the floor takes drags instead of scrolling the page. */
  arming?: boolean;
  mini?: boolean;
  svgRef?: Ref<SVGSVGElement>;
  onPointerDown?: PointerEventHandler<SVGSVGElement>;
  onPointerMove?: PointerEventHandler<SVGSVGElement>;
  onPointerUp?: PointerEventHandler<SVGSVGElement>;
  onPointerCancel?: PointerEventHandler<SVGSVGElement>;
}

export const Floor = memo(function Floor({ floor, label, fresh = -1, ghost, arming, mini, svgRef, ...handlers }: FloorProps) {
  const base = useMemo(() => floorMarkup(parseFloor(floor) ?? [], fresh), [floor, fresh]);
  const over = ghost ? ghostMarkup(ghost.cells, ghost.coat, ghost.ok) : '';
  return (
    <svg
      ref={svgRef}
      className={`floor${mini ? ' floor--mini' : ''}`}
      viewBox="0 0 700 700"
      role="img"
      aria-label={label}
      data-arming={arming ? 'true' : 'false'}
      {...handlers}
    >
      <g dangerouslySetInnerHTML={{ __html: base }} />
      <g dangerouslySetInnerHTML={{ __html: over }} />
    </svg>
  );
});
