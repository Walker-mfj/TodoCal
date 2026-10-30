"use client";

// Browser storage is optional. Keep exact serialized drafts/commands in this
// page when access is denied or quota is exhausted. Tombstones prevent failed
// deletes from restoring old commands while the page is still open.
export function createSessionStore(getStorage: () => Storage) {
  const memory = new Map<string, string | null>();
  const dirty = new Set<string>();
  const clearedOwners = new Set<string>();
  const listeners = new Set<() => void>();
  let unavailable = false;
  const ownerOf = (key: string) =>
    /^focus:(?:draft|form|command):([^:]+):/.exec(key)?.[1];
  const failed = () => {
    if (unavailable) return;
    unavailable = true;
    // Reads can occur during render; notify React subscribers afterwards.
    queueMicrotask(() => listeners.forEach((listener) => listener()));
  };
  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isUnavailable: () => unavailable,
    getItem(key: string): string | null {
      if (dirty.has(key)) return memory.get(key) ?? null;
      if (clearedOwners.has(ownerOf(key) || "") && !memory.has(key))
        return null;
      try {
        const value = getStorage().getItem(key);
        memory.set(key, value);
        return value;
      } catch {
        failed();
        return memory.get(key) ?? null;
      }
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
      dirty.add(key);
      try {
        getStorage().setItem(key, value);
        dirty.delete(key);
      } catch {
        failed();
      }
    },
    removeItem(key: string) {
      memory.set(key, null);
      dirty.add(key);
      try {
        getStorage().removeItem(key);
        dirty.delete(key);
      } catch {
        failed();
      }
    },
    keys(): string[] {
      const keys = new Set(memory.keys());
      try {
        const storage = getStorage();
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (
            key &&
            !(clearedOwners.has(ownerOf(key) || "") && !memory.has(key))
          )
            keys.add(key);
        }
      } catch {
        failed();
      }
      return [...keys].filter((key) => store.getItem(key) !== null);
    },
    clearOwner(owner: string) {
      const keys = store.keys().filter((key) => ownerOf(key) === owner);
      // Suppress unread browser values too, if key enumeration was denied.
      clearedOwners.add(owner);
      keys.forEach((key) => store.removeItem(key));
    },
  };
  return store;
}

export const sessionStore = createSessionStore(() => window.sessionStorage);
