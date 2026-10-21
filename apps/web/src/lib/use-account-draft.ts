"use client";
import { useEffect, useState } from "react";
export function useAccountDraft<T>(key: string, initial: T) {
  const [draft, setDraft] = useState(initial),
    [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) setDraft(JSON.parse(saved));
    } catch {}
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (ready) sessionStorage.setItem(key, JSON.stringify(draft));
  }, [key, draft, ready]);
  return { draft, setDraft, ready };
}
