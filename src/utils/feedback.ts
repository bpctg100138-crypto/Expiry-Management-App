/**
 * 100% offline Web Audio API scanner beep and vibration feedback.
 */
export function playScanFeedback(options: {
  beep: boolean;
  vibrate: boolean;
  type?: 'success' | 'warning';
}): void {
  if (options.vibrate && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(options.type === 'warning' ? [60, 40, 60] : 80);
    } catch {
      // Ignore vibration errors on unsupported browsers
    }
  }

  if (options.beep && typeof window !== 'undefined') {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = options.type === 'warning' ? 520 : 1240;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 250);
    } catch {
      // Ignore audio context blocks
    }
  }
}
