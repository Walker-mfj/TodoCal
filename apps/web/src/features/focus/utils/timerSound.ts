// Original synthesized cues; no third-party recordings or network requests.
export const timerSounds = [
  { value: "classic", label: "Classic" },
  { value: "bell", label: "Bell" },
  { value: "soft_bell", label: "Soft bell" },
  { value: "double_bell", label: "Double bell" },
  { value: "singing_bowl", label: "Singing bowl" },
  { value: "doorbell", label: "Doorbell" },
  { value: "chime", label: "Gentle chime" },
  { value: "digital", label: "Digital" },
] as const;

type Note = [
  frequency: number,
  offset: number,
  duration: number,
  volume: number,
];
const melodies: Record<string, Note[]> = {
  classic: [[660, 0, 0.6, 0.08]],
  bell: [
    [880, 0, 1.4, 0.08],
    [1760, 0, 0.7, 0.025],
    [2640, 0, 0.4, 0.01],
  ],
  soft_bell: [
    [523.25, 0, 1.8, 0.06],
    [1046.5, 0, 0.8, 0.012],
  ],
  double_bell: [
    [880, 0, 0.9, 0.07],
    [1760, 0, 0.4, 0.02],
    [880, 0.5, 1.3, 0.07],
    [1760, 0.5, 0.6, 0.02],
  ],
  singing_bowl: [
    [220, 0, 3, 0.07],
    [442, 0, 2.4, 0.035],
    [664, 0, 1.8, 0.015],
  ],
  doorbell: [
    [659.25, 0, 0.9, 0.07],
    [1318.5, 0, 0.4, 0.015],
    [523.25, 0.55, 1.4, 0.07],
    [1046.5, 0.55, 0.6, 0.015],
  ],
  chime: [
    [523.25, 0, 0.8, 0.06],
    [659.25, 0.2, 0.8, 0.06],
    [783.99, 0.4, 1.1, 0.06],
  ],
  digital: [
    [880, 0, 0.16, 0.06],
    [880, 0.24, 0.16, 0.06],
    [1174.66, 0.48, 0.3, 0.06],
  ],
};

export function playTimerSound(
  ctx: AudioContext,
  sound = "classic",
  volume = 75,
): () => void {
  const nodes: OscillatorNode[] = [];
  const level = Math.max(0, Math.min(100, volume)) / 75;
  if (level === 0) return () => {};
  const notes = melodies[sound] ?? melodies.classic;
  const originalDuration = Math.max(
    ...notes.map(([, offset, duration]) => offset + duration),
  );
  const stretch = 4.8 / originalDuration;
  for (const [frequency, originalOffset, originalLength, amplitude] of notes) {
    const offset = originalOffset * stretch;
    const duration = originalLength * stretch;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + offset;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(amplitude * 1.5 * level, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration);
    nodes.push(oscillator);
  }
  return () =>
    nodes.forEach((node) => {
      try {
        node.stop();
      } catch {}
    });
}
