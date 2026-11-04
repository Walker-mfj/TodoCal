import { expect, it, vi } from "vitest";
import { playTimerSound, timerSounds } from "./timerSound";
function audio() {
  const oscillators: any[] = [],
    gains: any[] = [];
  const ctx = {
    currentTime: 10,
    destination: {},
    createOscillator: () => {
      const node = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      oscillators.push(node);
      return node;
    },
    createGain: () => {
      const gain = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      };
      gains.push(gain);
      return gain;
    },
  };
  return { ctx: ctx as unknown as AudioContext, oscillators, gains };
}
it.each(timerSounds)(
  "plays $label for 4–6 seconds and can stop every note",
  ({ value }) => {
    const { ctx, oscillators } = audio();
    const stop = playTimerSound(ctx, value);
    const end =
      Math.max(...oscillators.map((node) => node.stop.mock.calls[0][0])) -
      ctx.currentTime;
    expect(end).toBeGreaterThanOrEqual(4);
    expect(end).toBeLessThanOrEqual(6);
    stop();
    expect(oscillators.every((node) => node.stop.mock.calls.length === 2)).toBe(
      true,
    );
  },
);
it("applies the selected volume and stays silent at zero", () => {
  const full = audio(),
    half = audio(),
    muted = audio();
  playTimerSound(full.ctx, "bell", 100);
  playTimerSound(half.ctx, "bell", 50);
  playTimerSound(muted.ctx, "bell", 0);
  expect(
    half.gains[0].gain.linearRampToValueAtTime.mock.calls[0][0],
  ).toBeCloseTo(
    full.gains[0].gain.linearRampToValueAtTime.mock.calls[0][0] / 2,
  );
  expect(muted.oscillators).toHaveLength(0);
});
