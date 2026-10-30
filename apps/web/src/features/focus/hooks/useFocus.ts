"use client";
import { useEffect, useRef, useState } from "react";
import { useOwnedQuery } from "../../auth/hooks/useOwnedQuery";
import { useSession } from "../../auth/components/sessionProvider/sessionProvider";
import { useCommand } from "../../../shared/hooks/useCommand";
import type { components } from "../../../shared/api/apiTypes.generated";
import { remainingSeconds } from "../utils/clock";
export type FocusState = components["schemas"]["FocusState"];
export type FocusKind = components["schemas"]["FocusSession"]["kind"];
export function useFocus() {
  const { session, execute, connected } = useSession();
  const query = useOwnedQuery<FocusState>("focus", "/focus");
  const command = useCommand(
    execute,
    `focus:command:${session!.user.id}:timer`,
  );
  const anchor = useRef({ at: performance.now(), version: 0 });
  if (anchor.current.version !== query.dataUpdatedAt) {
    anchor.current = { at: performance.now(), version: query.dataUpdatedAt };
  }
  const [tick, setTick] = useState(performance.now());
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<string | null>(null);
  const checked = useRef("");
  const [permission, setPermission] = useState<string>(
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission,
  );
  useEffect(() => {
    const id = setInterval(() => setTick(performance.now()), 250);
    return () => clearInterval(id);
  }, []);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  const state = query.data;
  const active = state?.active;
  const remaining = active
    ? remainingSeconds(
        active,
        anchor.current.at,
        Math.max(tick, anchor.current.at),
      )
    : 0;
  useEffect(() => {
    if (active?.status === "running" && remaining === 0 && connected) {
      const key = `${active.id}:${active.revision}:${query.dataUpdatedAt}`;
      if (checked.current !== key) {
        checked.current = key;
        void query.refetch();
      }
    }
  }, [active, remaining, connected, query.dataUpdatedAt]);
  useEffect(() => {
    if (
      previous.current &&
      state?.last?.id === previous.current &&
      state.last.status === "completed"
    ) {
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
  }, [state, session]);
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
    remaining,
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
