"use client";
import { sessionStore } from "./session-storage";
import { useEffect, useState } from "react";
export function useAccountDraft<T>(key: string, initial: T) {
  const [draft, setDraft] = useState(initial),
    [loadedKey, setLoadedKey] = useState<string | null>(null);
  const ready = loadedKey === key;
  useEffect(() => {
    try {
      const saved = sessionStore.getItem(key);
      setDraft(saved ? JSON.parse(saved) : initial);
    } catch {
      setDraft(initial);
    }
    setLoadedKey(key);
  }, [key]);
  useEffect(() => {
    if (ready) sessionStore.setItem(key, JSON.stringify(draft));
  }, [key, draft, ready]);
  return { draft: ready ? draft : initial, setDraft, ready };
}
