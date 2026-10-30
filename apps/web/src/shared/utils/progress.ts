export function progressLevel(value: number | null) {
  return value === null
    ? "empty"
    : value === 0
      ? "zero"
      : value < 50
        ? "starting"
        : value < 80
          ? "building"
          : value < 100
            ? "strong"
            : "complete";
}

export function completionRatio(day: {
  planned: number;
  completed: number;
  percentage: number | null;
}) {
  return day.percentage === null || day.planned === 0
    ? null
    : (day.completed * 100) / day.planned;
}
