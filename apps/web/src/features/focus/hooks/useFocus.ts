"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOwnedQuery } from "../../auth/hooks/useOwnedQuery";
import { useSession } from "../../auth/components/sessionProvider/sessionProvider";
import { useCommand } from "../../../shared/hooks/useCommand";
import type { components } from "../../../shared/api/apiTypes.generated";
export type FocusState = components["schemas"]["FocusState"];
export type FocusKind = components["schemas"]["FocusSession"]["kind"];
export function useFocus() {
  const { session, execute, connected } = useSession();
  const query = useOwnedQuery<FocusState>("focus", "/focus");
  const client = useQueryClient();
  const command = useCommand(
    execute,
    `focus:command:${session!.user.id}:timer`,
  );
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<string | null>(null);
  const checked = useRef("");
  const [permission, setPermission] = useState<string>(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  const state = query.data;
  const active = state?.active;
  // Anchor each server snapshot once in the shared controller. Newly mounted
  // displays must not restart the countdown from the old elapsedSeconds.
  const received = useRef({
    version: query.dataUpdatedAt,
    at: performance.now(),
  });
  if (received.current.version !== query.dataUpdatedAt) {
    received.current = {
      version: query.dataUpdatedAt,
      at: performance.now(),
    };
  }
  const receivedAt = received.current.at;
  // No tick at this level anymore: schedule a single refetch for the moment
  // the running session expires, so the server can confirm completion.
  useEffect(() => {
    if (active?.status !== "running" || !connected) return;
    const key = `${active.id}:${active.revision}:${query.dataUpdatedAt}`;
    if (checked.current === key) return;
    const ms = Math.max(
      0,
      (active.targetSeconds - active.elapsedSeconds) * 1000 -
        (performance.now() - receivedAt),
    );
    const id = setTimeout(() => {
      checked.current = key;
      void query.refetch();
    }, ms + 300);
    return () => clearTimeout(id);
  }, [active, connected, query.dataUpdatedAt, receivedAt]);
  useEffect(() => {
    if (
      previous.current &&
      state?.last?.id === previous.current &&
      state.last.status === "completed"
    ) {
      // GET /focus settles the session server-side; refresh derived views
      // without refetching the already up-to-date focus query.
      void client.invalidateQueries({
        predicate: (entry) =>
          entry.queryKey[0] === session!.user.id &&
          entry.queryKey[1] !== "focus",
      });
      if (session!.settings.sound && audio.current?.state === "running") {
        try {
          const ctx = audio.current,
            osc = ctx.createOscillator(),
            gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
          osc.frequency.value = 660;
          osc.start();
          osc.stop(ctx.currentTime + 0.6);
        } catch {}
      }
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          new Notification("Session complete", {
            body: "Your time is saved. Start the next session whenever you are ready.",
          });
        } catch {}
      }
    }
    previous.current = state?.active?.id || null;
  }, [state, session, client]);
  const primeSound = () => {
    if (!session!.settings.sound) return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    } catch {}
  };
  const start = (
    kind: FocusKind,
    taskId?: string,
    durationMinutes?: number,
  ) => {
    primeSound();
    void command.run("/focus", "POST", {
      kind,
      ...(durationMinutes === undefined ? {} : { durationMinutes }),
      taskId: kind === "focus" ? taskId || null : null,
    });
  };
  const change = (action: "pause" | "resume" | "end") => {
    if (!active) return;
    if (action === "resume") primeSound();
    void command.run(`/focus/${active.id}/${action}`, "POST", {
      expectedRevision: active.revision,
    });
  };
  return {
    query,
    state,
    active,
    receivedAt,
    command,
    connected,
    permission,
    start,
    change,
    blocked:
      !connected ||
      query.isPending ||
      !!query.error ||
      command.busy ||
      command.uncertain,
    retry: () => void command.run("", "POST", {}),
    enableNotifications: async () => {
      try {
        setPermission(await Notification.requestPermission());
      } catch {
        setPermission("denied");
      }
    },
  };
}
export type FocusController = ReturnType<typeof useFocus>;
