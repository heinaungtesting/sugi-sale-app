const TAP_HAPTIC_PATTERN = [50] as const;

/** Best-effort physical acknowledgement for a confirmed product tap. */
export function triggerTapHaptic(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

  try {
    navigator.vibrate([...TAP_HAPTIC_PATTERN]);
  } catch {
    // Haptics must never block or break the sale logging path.
  }
}
