import {
  ADMIT_TONES,
  ADMIT_VIBRATION,
  GateFeedback,
  REFUSE_TONES,
  REFUSE_VIBRATION,
  makeWav,
} from './gate-feedback.service';

class TestFeedback extends GateFeedback {
  played: string[] = [];
  buzzes: (readonly number[])[] = [];
  blockAudio = false;

  protected override createAudio(blob: Blob): HTMLAudioElement {
    const kind = blob.size === makeWav(ADMIT_TONES).length ? 'admit' : 'refuse';
    const audio = {
      muted: false,
      currentTime: 0,
      pause: () => undefined,
      play: () => {
        if (this.blockAudio) return Promise.reject(new Error('NotAllowedError'));
        if (!audio.muted) this.played.push(kind);
        return Promise.resolve();
      },
    };
    return audio as unknown as HTMLAudioElement;
  }
  protected override vibrate(pattern: readonly number[]): void {
    this.buzzes.push(pattern);
  }
}

describe('verdict feedback', () => {
  it('admitted is one short high tone; refused is two low tones', () => {
    expect(ADMIT_TONES.length).toBe(1);
    expect(REFUSE_TONES.length).toBe(2);
    expect(ADMIT_TONES[0].freq).toBeGreaterThan(REFUSE_TONES[0].freq * 3);
    expect(ADMIT_TONES[0].ms).toBeLessThan(REFUSE_TONES[0].ms);
  });

  it('admitted buzzes once, briefly; refused buzzes once, long', () => {
    expect(ADMIT_VIBRATION.length).toBe(1);
    expect(REFUSE_VIBRATION.length).toBe(1);
    expect(REFUSE_VIBRATION[0]).toBeGreaterThan(ADMIT_VIBRATION[0] * 2);
  });

  describe('makeWav', () => {
    it('writes a valid PCM header sized to the tones', () => {
      const wav = makeWav(ADMIT_TONES);
      const text = (a: number, b: number): string => String.fromCharCode(...wav.slice(a, b));
      expect(text(0, 4)).toBe('RIFF');
      expect(text(8, 12)).toBe('WAVE');
      expect(text(36, 40)).toBe('data');
      const view = new DataView(wav.buffer);
      expect(view.getUint32(40, true)).toBe(wav.length - 44);
      expect(view.getUint32(4, true)).toBe(wav.length - 8);
    });

    it('is audible (not silence) and fades in and out without a click', () => {
      const wav = makeWav(ADMIT_TONES);
      const view = new DataView(wav.buffer);
      const n = (wav.length - 44) / 2;
      let peak = 0;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(view.getInt16(44 + i * 2, true)));
      expect(peak).toBeGreaterThan(20_000);
      expect(Math.abs(view.getInt16(44, true))).toBeLessThan(500);
      expect(Math.abs(view.getInt16(44 + (n - 1) * 2, true))).toBeLessThan(2_000);
    });

    it('keeps the gap between the two refusal tones silent', () => {
      const wav = makeWav(REFUSE_TONES);
      const view = new DataView(wav.buffer);
      const first = Math.round((REFUSE_TONES[0].ms / 1000) * 22_050);
      const gap = Math.round(((REFUSE_TONES[0].gapAfterMs ?? 0) / 1000) * 22_050);
      for (let i = first + 5; i < first + gap - 5; i += 20) {
        expect(view.getInt16(44 + i * 2, true)).toBe(0);
      }
    });
  });

  describe('GateFeedback', () => {
    it('plays the admitted sound and buzz for an admission', () => {
      const f = new TestFeedback();
      f.play(true);
      expect(f.played).toEqual(['admit']);
      expect(f.buzzes).toEqual([ADMIT_VIBRATION]);
    });

    it('plays the refusal sound and the long buzz otherwise', () => {
      const f = new TestFeedback();
      f.play(false);
      expect(f.played).toEqual(['refuse']);
      expect(f.buzzes).toEqual([REFUSE_VIBRATION]);
    });

    it('asks for a touch when the browser refuses to play, and clears it once primed', async () => {
      const f = new TestFeedback();
      f.blockAudio = true;
      f.play(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(f.needsTap()).toBeTrue();
      f.blockAudio = false;
      f.prime();
      await Promise.resolve();
      await Promise.resolve();
      expect(f.needsTap()).toBeFalse();
    });
  });
});
