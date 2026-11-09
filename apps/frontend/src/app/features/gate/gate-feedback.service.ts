import { Injectable, signal } from '@angular/core';

/** A tone in a verdict sound: pitch, length, and the silence after it. */
export interface Tone {
  freq: number;
  ms: number;
  gapAfterMs?: number;
}

/** Admitted: one short, high tone. */
export const ADMIT_TONES: readonly Tone[] = [{ freq: 1320, ms: 170 }];
/** Refused: two low tones. */
export const REFUSE_TONES: readonly Tone[] = [
  { freq: 196, ms: 280, gapAfterMs: 130 },
  { freq: 196, ms: 280 },
];

/** Admitted: one short buzz. Refused: one long buzz. */
export const ADMIT_VIBRATION: readonly number[] = [200];
export const REFUSE_VIBRATION: readonly number[] = [900];

const SAMPLE_RATE = 22_050;
const FADE_MS = 8;

/**
 * Renders the tones as a 16-bit mono PCM WAV file. Playing a real audio
 * element (rather than a Web Audio oscillator) matters at the gate: on iOS a
 * Web Audio context is muted by the silent switch, while media playback is
 * not, and on Android it follows the media volume instead of the ringer.
 */
export function makeWav(tones: readonly Tone[]): Uint8Array {
  const samplesFor = (ms: number): number => Math.round((ms / 1000) * SAMPLE_RATE);
  const total = tones.reduce((n, t) => n + samplesFor(t.ms) + samplesFor(t.gapAfterMs ?? 0), 0);
  const bytes = new Uint8Array(44 + total * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + total * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, total * 2, true);

  let at = 44;
  const fade = samplesFor(FADE_MS);
  for (const tone of tones) {
    const n = samplesFor(tone.ms);
    for (let i = 0; i < n; i++) {
      const envelope = Math.min(1, i / fade, (n - 1 - i) / fade);
      // A touch of the second harmonic carries better in a noisy crowd.
      const phase = (2 * Math.PI * tone.freq * i) / SAMPLE_RATE;
      const sample = (Math.sin(phase) * 0.8 + Math.sin(2 * phase) * 0.2) * envelope * 0.95;
      view.setInt16(at, Math.round(sample * 32767), true);
      at += 2;
    }
    at += samplesFor(tone.gapAfterMs ?? 0) * 2; // silence is already zeroed
  }
  return bytes;
}

/**
 * Sound and vibration for a verdict. The steward is looking at the person,
 * not the screen, so every verdict is also heard and felt.
 *
 * Browsers only let a page make sound after the user has touched it. The gate
 * is normally reached by a tap, which counts; when it was not (page opened
 * directly or reloaded), `needsTap` turns true and the page asks for a touch
 * and primes the audio then.
 */
@Injectable({ providedIn: 'root' })
export class GateFeedback {
  /** True while a sound has been refused by the browser and a touch is needed. */
  readonly needsTap = signal(false);

  private admit: HTMLAudioElement | null = null;
  private refuse: HTMLAudioElement | null = null;

  /** Unlocks audio playback; call from a touch/click handler. */
  prime(): void {
    for (const audio of this.audios()) {
      audio.muted = true;
      void audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          this.needsTap.set(false);
        })
        .catch(() => {
          audio.muted = false;
          this.needsTap.set(true);
        });
    }
  }

  /** Plays the admitted pattern (true) or the refused pattern (false). */
  play(admitted: boolean): void {
    const [admit, refuse] = this.audios();
    const audio = admitted ? admit : refuse;
    audio.currentTime = 0;
    audio.muted = false;
    void audio.play().catch(() => this.needsTap.set(true));
    this.vibrate(admitted ? ADMIT_VIBRATION : REFUSE_VIBRATION);
  }

  /** Overridable for tests. */
  protected createAudio(blob: Blob): HTMLAudioElement {
    const audio = new Audio(URL.createObjectURL(blob));
    audio.preload = 'auto';
    audio.volume = 1;
    return audio;
  }

  protected vibrate(pattern: readonly number[]): void {
    // Not available on iOS Safari; a refusal to vibrate is not an error.
    try {
      navigator.vibrate?.([...pattern]);
    } catch {
      // ignore
    }
  }

  private audios(): [HTMLAudioElement, HTMLAudioElement] {
    if (!this.admit || !this.refuse) {
      this.admit = this.createAudio(new Blob([makeWav(ADMIT_TONES)], { type: 'audio/wav' }));
      this.refuse = this.createAudio(new Blob([makeWav(REFUSE_TONES)], { type: 'audio/wav' }));
    }
    return [this.admit, this.refuse];
  }
}
