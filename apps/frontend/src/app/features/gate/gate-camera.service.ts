import { Injectable } from '@angular/core';

/** Why the camera could not be used; the page falls back to manual entry. */
export type CameraFailure = 'denied' | 'unavailable' | 'insecure';

export class CameraError extends Error {
  constructor(readonly reason: CameraFailure) {
    super(`camera ${reason}`);
  }
}

export interface CameraSession {
  stop(): void;
}

/**
 * Decides which camera frames count as a new code. A QR that stays in front
 * of the lens would otherwise be read again and again — including straight
 * after the steward dismisses a verdict, which would flag the person just
 * admitted as "already used". A code is handled once, then ignored until it
 * has been out of sight for a moment (or a different code appears).
 */
export class RepeatGuard {
  /** Empty frames in a row that count as "the code is gone". */
  static readonly CLEAR_AFTER = 8;

  private last: string | null = null;
  private empty = 0;

  /** Feed every frame's result (null = nothing found); returns a code to handle, or null. */
  frame(text: string | null): string | null {
    if (text === null) {
      if (++this.empty >= RepeatGuard.CLEAR_AFTER) this.last = null;
      return null;
    }
    this.empty = 0;
    if (text === this.last) return null;
    this.last = text;
    return text;
  }
}

/** Reads one QR code from the current video frame, or null. */
type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

/** Minimal typing for the Shape Detection API (not in lib.dom). */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

const FRAME_INTERVAL_MS = 120;
const MAX_DECODE_SIDE = 640;

/**
 * The gate's camera. Permission is asked only when `start` is called, which
 * only the gate page does. Uses the browser's built-in barcode detection
 * where it supports QR codes, and the jsQR library (loaded on demand)
 * everywhere else.
 */
@Injectable({ providedIn: 'root' })
export class GateCamera {
  async start(
    video: HTMLVideoElement,
    onFrame: (code: string | null) => void,
    isPaused: () => boolean,
  ): Promise<CameraSession> {
    if (!window.isSecureContext) throw new CameraError('insecure');
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unavailable');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      throw new CameraError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };

    try {
      video.muted = true;
      video.setAttribute('playsinline', '');
      video.srcObject = stream;
      await video.play();
      const decode = await this.pickDecoder();

      const tick = async (): Promise<void> => {
        if (stopped) return;
        if (!isPaused() && video.readyState >= 2 && !document.hidden) {
          try {
            onFrame(await decode(video));
          } catch {
            onFrame(null);
          }
        }
        if (!stopped) timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS);
      };
      void tick();
    } catch (e) {
      stop();
      throw e instanceof CameraError ? e : new CameraError('unavailable');
    }
    return { stop };
  }

  private async pickDecoder(): Promise<Decoder> {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (Detector) {
      try {
        const formats = (await Detector.getSupportedFormats?.()) ?? [];
        if (formats.includes('qr_code')) {
          const detector = new Detector({ formats: ['qr_code'] });
          return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
        }
      } catch {
        // fall through to the library
      }
    }
    const { default: jsQR } = await import('jsqr');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (video) => {
      if (!ctx || !video.videoWidth) return null;
      const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    };
  }
}
