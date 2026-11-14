/**
 * The maths of the seat board's pinch-zoom and pan, with no DOM in it.
 *
 * The board is drawn once at its natural size (seat = SEAT_PX) and shown through
 * a transform: `translate(x, y) scale(k)`, origin top-left. A viewport of
 * `view` px shows the board between `x` and `x + board.w * k`.
 */

export interface View {
  /** Scale factor: 1 = natural size. */
  readonly k: number;
  /** Translation of the board's top-left corner inside the viewport, px. */
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly w: number;
  readonly h: number;
}

/** Natural size of a seat on the board, px: the project's 44 px minimum tap target (every button has min-height 44). */
export const SEAT_PX = 44;
/** Natural gap between seats, px. */
export const GAP_PX = 6;
/** Zoom ceiling: a seat is then 55 px. */
export const MAX_K = 1.25;
/** Below this on-screen seat size (px) a touch cannot hit a seat reliably: the tap zooms in instead of selecting. */
export const MIN_TOUCH_SEAT_PX = 32;
/** The same for a mouse or pen. */
export const MIN_POINTER_SEAT_PX = 18;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** The scale at which the whole board fits the viewport's width (never above 1: small boards are not blown up). */
export function fitScale(board: Size, view: Size): number {
  if (board.w <= 0 || view.w <= 0) return 1;
  return Math.min(1, view.w / board.w);
}

/**
 * Keeps the board on screen: when it is smaller than the viewport on an axis it is
 * centred (horizontally) or pinned to the top (vertically); when larger it may not
 * be dragged so far that empty space shows beside it.
 */
export function constrain(view: View, board: Size, port: Size): View {
  const w = board.w * view.k;
  const h = board.h * view.k;
  const x = w <= port.w ? (port.w - w) / 2 : clamp(view.x, port.w - w, 0);
  const y = h <= port.h ? 0 : clamp(view.y, port.h - h, 0);
  return { k: view.k, x, y };
}

/** Changes scale to `k`, keeping the board point under (px, py) where it is. */
export function zoomAt(view: View, k: number, px: number, py: number, minK: number): View {
  const next = clamp(k, minK, MAX_K);
  const ratio = next / view.k;
  return { k: next, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/** The board point (natural px) under a viewport point. */
export function toBoard(view: View, px: number, py: number): { x: number; y: number } {
  return { x: (px - view.x) / view.k, y: (py - view.y) / view.k };
}

/** A view of scale `k` that puts board point (bx, by) at the viewport's centre. */
export function centreOn(bx: number, by: number, k: number, port: Size): View {
  return { k, x: port.w / 2 - bx * k, y: port.h / 2 - by * k };
}

/** Distance and midpoint of two pointers, the inputs of a pinch. */
export function pinchOf(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { distance: number; cx: number; cy: number } {
  return { distance: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

/** Can a seat at this scale be hit reliably? Touch needs bigger targets than a mouse. */
export function seatIsTappable(k: number, pointerType: string): boolean {
  const px = SEAT_PX * k;
  return px >= (pointerType === 'touch' ? MIN_TOUCH_SEAT_PX : MIN_POINTER_SEAT_PX);
}

/** Extra gap where an aisle sits, px. */
export const AISLE_PX = 28;
/** Width of the row-label column, px. */
export const LABEL_PX = 44;
