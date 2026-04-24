/**
 * Audio mixer for live overlay music.
 *
 * Combines the host's microphone track with an HTMLAudioElement (music) into
 * a single MediaStreamTrack that can be sent to viewers via sender.replaceTrack().
 *
 * Two modes:
 *   - mixWithMic=true  → viewers hear mic + music together
 *   - mixWithMic=false → viewers hear music only (mic muted)
 *
 * The output track is stable for the lifetime of the mixer — changing volume,
 * play/pause, or mix mode does not require replacing the track again.
 */

export interface OverlayAudioMixerOptions {
  micTrack: MediaStreamTrack | null;
  audioElement: HTMLAudioElement;
  mixWithMic: boolean;
  volume: number; // 0..1 (music gain)
}

export interface OverlayAudioMixer {
  /** The combined track to hand to sender.replaceTrack(). */
  outputTrack: MediaStreamTrack;
  setVolume: (v: number) => void;
  setMixWithMic: (mix: boolean) => void;
  /** Stop and release all nodes. Output track will end. */
  destroy: () => void;
}

export function createOverlayAudioMixer(
  opts: OverlayAudioMixerOptions
): OverlayAudioMixer {
  const AudioCtx =
    (window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext) as typeof AudioContext;
  if (!AudioCtx) {
    throw new Error("Web Audio API not available in this browser");
  }

  const ctx = new AudioCtx();
  // Resuming here is important on iOS — AudioContext is suspended until a
  // user gesture. Callers should only invoke this from a click handler.
  void ctx.resume().catch(() => {});

  const destination = ctx.createMediaStreamDestination();

  // Music source — create once from the <audio> element.
  // crossOrigin must be set on the element before play() for captureStream-style
  // routing; since we use MediaElementSource we also need permissive CORS on
  // the audio URL. Supabase Storage public bucket serves proper CORS headers.
  const musicSource = ctx.createMediaElementSource(opts.audioElement);
  const musicGain = ctx.createGain();
  musicGain.gain.value = clamp01(opts.volume);
  musicSource.connect(musicGain).connect(destination);

  // Mic source (may be absent if host had no mic)
  let micStream: MediaStream | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  const micGain = ctx.createGain();
  micGain.gain.value = opts.mixWithMic ? 1 : 0;
  micGain.connect(destination);

  if (opts.micTrack) {
    micStream = new MediaStream([opts.micTrack]);
    micSource = ctx.createMediaStreamSource(micStream);
    micSource.connect(micGain);
  }

  const [outputTrack] = destination.stream.getAudioTracks();

  return {
    outputTrack,
    setVolume(v: number) {
      musicGain.gain.value = clamp01(v);
    },
    setMixWithMic(mix: boolean) {
      micGain.gain.value = mix ? 1 : 0;
    },
    destroy() {
      try {
        musicSource.disconnect();
        micSource?.disconnect();
        musicGain.disconnect();
        micGain.disconnect();
      } catch {
        // ignore — nodes may already be disconnected
      }
      try {
        outputTrack.stop();
      } catch {
        // ignore
      }
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    },
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
