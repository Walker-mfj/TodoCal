"use client";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../auth";
import type { Task } from "../../../shared/api/domainTypes";
export function useFocusTasks(focusDate: string) {
  const { session, read } = useSession();
  return useQuery({
    queryKey: [session?.user.id, "focus-task-choices", focusDate],
    queryFn: async ({ signal }) => {
      const result: Task[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: "100", view: "today" });
        if (cursor) params.set("cursor", cursor);
        const page = await read<{ items: Task[]; nextCursor: string | null }>(
          `/tasks?${params}`,
          { signal, owner: session?.user.id },
        );
        result.push(...page.items.filter((t) => t.scheduledDate === focusDate));
        cursor = page.nextCursor;
      } while (cursor);
      return result;
    },
  });
}
