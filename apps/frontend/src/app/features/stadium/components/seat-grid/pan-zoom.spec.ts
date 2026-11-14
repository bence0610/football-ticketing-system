import {
  GAP_PX,
  MAX_K,
  MIN_POINTER_SEAT_PX,
  MIN_TOUCH_SEAT_PX,
  SEAT_PX,
  centreOn,
  constrain,
  fitScale,
  pinchOf,
  seatIsTappable,
  toBoard,
  zoomAt,
} from './pan-zoom';

describe('pan-zoom maths', () => {
  const board = { w: 1426, h: 800 }; // a 28-wide, 16-row sector
  const phone = { w: 328, h: 400 };

  it('fits the board to the width, but never blows a small board up', () => {
    expect(fitScale(board, phone)).toBeCloseTo(328 / 1426, 5);
    expect(fitScale({ w: 200, h: 100 }, phone)).toBe(1);
  });

  it('keeps the point under the fingers where it is while zooming', () => {
    const v = { k: 0.5, x: -100, y: -50 };
    const before = toBoard(v, 120, 80);
    const next = zoomAt(v, 1, 120, 80, 0.24);
    const after = toBoard(next, 120, 80);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('never zooms beyond the ceiling or below the fit', () => {
    expect(zoomAt({ k: 1, x: 0, y: 0 }, 9, 0, 0, 0.24).k).toBe(MAX_K);
    expect(zoomAt({ k: 1, x: 0, y: 0 }, 0.01, 0, 0, 0.24).k).toBe(0.24);
  });

  it('centres a board that is narrower than the window and stops a wide one leaving a gap', () => {
    expect(constrain({ k: 1, x: 99, y: 0 }, { w: 200, h: 100 }, phone).x).toBe(64);
    const wide = constrain({ k: 1, x: 50, y: 40 }, board, phone);
    expect(wide.x).toBe(0); // cannot drag the left edge right of the window's left edge
    expect(wide.y).toBe(0);
    const far = constrain({ k: 1, x: -5000, y: -5000 }, board, phone);
    expect(far.x).toBe(phone.w - board.w);
    expect(far.y).toBe(phone.h - board.h);
  });

  it('centres a chosen board point', () => {
    const v = centreOn(500, 300, 1, phone);
    expect(toBoard(v, phone.w / 2, phone.h / 2)).toEqual({ x: 500, y: 300 });
  });

  it('measures a pinch', () => {
    const p = pinchOf({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(p.distance).toBe(50);
    expect(p.cx).toBe(15);
    expect(p.cy).toBe(20);
  });

  describe('tap targets', () => {
    it('a seat is a 44 px square at natural size, 55 px at the zoom ceiling', () => {
      expect(SEAT_PX).toBe(44);
      expect(SEAT_PX * MAX_K).toBe(55);
      expect(GAP_PX).toBe(6);
    });

    it('a finger needs 32 px, a mouse 18 px', () => {
      expect(MIN_TOUCH_SEAT_PX).toBe(32);
      expect(MIN_POINTER_SEAT_PX).toBe(18);
      expect(seatIsTappable(0.72, 'touch')).toBeFalse(); // 31.7 px
      expect(seatIsTappable(0.73, 'touch')).toBeTrue();
      expect(seatIsTappable(0.41, 'mouse')).toBeTrue(); // 18 px
      expect(seatIsTappable(0.4, 'mouse')).toBeFalse();
    });

    it('the whole 28-seat row at 360 px is an overview, not a tap target: a tap zooms', () => {
      const k = fitScale(board, phone);
      expect(SEAT_PX * k).toBeLessThan(MIN_TOUCH_SEAT_PX);
      expect(seatIsTappable(k, 'touch')).toBeFalse();
    });
  });
});
