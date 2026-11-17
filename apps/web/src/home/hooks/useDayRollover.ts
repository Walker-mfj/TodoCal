import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useDayRollover(owner: string, date: string) {
  const client = useQueryClient();
  const previous = useRef({ owner, date });
  useEffect(() => {
    const last = previous.current;
    previous.current = { owner, date };
    if (last.owner !== owner || last.date === date) return;
    // Keep the selected range, but refresh server-computed historical status
    // and progress. Inactive queries are marked stale for their next mount.
    void client.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === owner &&
        ["calendar", "period", "day", "tasks"].includes(String(queryKey[1])),
    });
  }, [client, owner, date]);
}
