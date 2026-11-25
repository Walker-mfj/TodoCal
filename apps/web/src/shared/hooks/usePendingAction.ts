"use client";
import { useState } from "react";
// Counts are independent by action identity, including overlapping requests for one key.
export function usePendingAction() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  async function run(key: string, action: () => unknown) {
    const result = action();
    if (!result || typeof (result as PromiseLike<unknown>).then !== "function")
      return;
    setCounts((old) => ({ ...old, [key]: (old[key] || 0) + 1 }));
    try {
      await result;
    } finally {
      setCounts((old) => {
        const next = { ...old };
        if (next[key] > 1) next[key]--;
        else delete next[key];
        return next;
      });
    }
  }
  return { isPending: (key: string) => (counts[key] || 0) > 0, run };
}
