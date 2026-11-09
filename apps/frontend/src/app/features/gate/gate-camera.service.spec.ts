import { RepeatGuard } from './gate-camera.service';

describe('RepeatGuard', () => {
  const absent = (g: RepeatGuard, frames = RepeatGuard.CLEAR_AFTER): void => {
    for (let i = 0; i < frames; i++) g.frame(null);
  };

  it('hands a new code over once', () => {
    const g = new RepeatGuard();
    expect(g.frame('A')).toBe('A');
  });

  it('ignores the same code while it stays in front of the camera', () => {
    const g = new RepeatGuard();
    g.frame('A');
    expect(g.frame('A')).toBeNull();
    expect(g.frame('A')).toBeNull();
  });

  it('a short gap in detection does not re-arm the code (a flicker is not a new person)', () => {
    const g = new RepeatGuard();
    g.frame('A');
    absent(g, RepeatGuard.CLEAR_AFTER - 1);
    expect(g.frame('A')).toBeNull();
  });

  it('accepts the same code again once it has been out of sight', () => {
    const g = new RepeatGuard();
    g.frame('A');
    absent(g);
    expect(g.frame('A')).toBe('A');
  });

  it('accepts a different code straight away', () => {
    const g = new RepeatGuard();
    g.frame('A');
    expect(g.frame('B')).toBe('B');
  });
});
