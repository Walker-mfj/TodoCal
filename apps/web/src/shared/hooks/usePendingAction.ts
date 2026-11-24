"use client";
import { useRef, useState } from "react";
// Track only an operation started by this rendered control, never shared disabled state.
export function usePendingAction() {
  const [pending, setPending] = useState<string | null>(null);
  const active = useRef<symbol | null>(null);
  async function run(key: string, action: () => unknown) {
    const result = action();
    if (!result || typeof (result as PromiseLike<unknown>).then !== "function")
      return;
    const token = Symbol();
    active.current = token;
    setPending(key);
    try {
      await result;
    } finally {
      if (active.current === token) {
        active.current = null;
        setPending(null);
      }
    }
  }
  return { pending, run };
}
