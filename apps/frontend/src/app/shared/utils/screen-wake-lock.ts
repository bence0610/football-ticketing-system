/** The slice of the Screen Wake Lock API used here. */
interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
}
interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

/**
 * Keeps the screen awake while held (a dim or sleeping phone at the gate or
 * in a dark stadium is useless). Browsers drop the lock whenever the tab is
 * hidden, so it is requested again when the tab comes back. Unsupported
 * browsers and refused requests are silently ignored — nothing depends on it.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | null = null;
  private held = false;
  private readonly onVisible = (): void => {
    if (this.held && this.doc.visibilityState === 'visible') void this.request();
  };

  constructor(private readonly doc: Document) {}

  acquire(): void {
    if (this.held) return;
    this.held = true;
    this.doc.addEventListener('visibilitychange', this.onVisible);
    void this.request();
  }

  release(): void {
    this.held = false;
    this.doc.removeEventListener('visibilitychange', this.onVisible);
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => undefined);
  }

  private async request(): Promise<void> {
    if (!this.held || this.sentinel) return;
    const nav = this.doc.defaultView?.navigator as WakeLockNavigator | undefined;
    if (!nav?.wakeLock) return;
    try {
      const sentinel = await nav.wakeLock.request('screen');
      if (!this.held) {
        void sentinel.release().catch(() => undefined);
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // Denied (battery saver, hidden tab) — carry on without it.
    }
  }
}
