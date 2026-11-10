"use client";
import { sessionStore } from "../utils/sessionStorage";
import { useEffect, useEffectEvent, useState } from "react";
export function useAccountDraft<T>(key: string, initial: T) {
  const [draft, setDraft] = useState(initial),
    [loadedKey, setLoadedKey] = useState<string | null>(null);
  const ready = loadedKey === key;
  // Updated server props must not reset an in-progress draft for the same key.
  const initialForKey = useEffectEvent(() => initial);
  useEffect(() => {
    try {
      const saved = sessionStore.getItem(key);
      setDraft(saved ? JSON.parse(saved) : initialForKey());
    } catch {
      setDraft(initialForKey());
    }
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (ready) sessionStore.setItem(key, JSON.stringify(draft));
  }, [key, draft, ready]);
  return { draft: ready ? draft : initial, setDraft, ready };
}
