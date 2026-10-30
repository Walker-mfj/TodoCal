export function remainingSeconds(
  session: { targetSeconds: number; elapsedSeconds: number; status: string },
  receivedAt: number,
  now: number,
) {
  const elapsed =
    session.elapsedSeconds +
    (session.status === "running" ? Math.max(0, now - receivedAt) / 1000 : 0);
  return Math.max(0, Math.ceil(session.targetSeconds - elapsed));
}
export function timerLabel(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export const kindLabel = {
  focus: "Focus",
  short_break: "Short break",
  long_break: "Long break",
};
