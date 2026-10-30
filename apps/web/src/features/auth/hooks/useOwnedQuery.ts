"use client";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../components/sessionProvider/sessionProvider";
export function useOwnedQuery<T>(name: string, path: string, enabled = true) {
  const { session, read } = useSession();
  return useQuery({
    queryKey: [session?.user.id, name, path],
    queryFn: async ({ signal }) => {
      // Strict Mode can unsubscribe synchronously during its mount check.
      // Let that cancellation settle before starting network work.
      await Promise.resolve();
      signal.throwIfAborted();
      return read<T>(path, { signal, owner: session?.user.id });
    },
    enabled: !!session && enabled,
  });
}
