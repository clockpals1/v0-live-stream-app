/**
 * Plays a short "ding" notification sound using the Web Audio API.
 * No audio file required — works on desktop and mobile.
 */
export function playNotificationSound() {
  try {
    const AudioCtx =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    const osc = ctx.createOscillator();
    osc.connect(gain);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);       // A5
    osc.frequency.exponentialRampToValueAtTime(550, ctx.currentTime + 0.4); // D#5
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
    ctx.resume();
  } catch {}
}

/**
 * Vibrates the device with the given pattern (ms on/off/on…).
 * No-op on desktop or browsers that don't support the Vibration API.
 */
export function vibrateDevice(pattern: number | number[] = [80, 40, 80]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {}
}
