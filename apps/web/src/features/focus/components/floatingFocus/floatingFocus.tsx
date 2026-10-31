"use client";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./floatingFocus.module.css";
const cx = bindStyles(styles);

import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { timerLabel } from "../../utils/clock";
import type { FocusController } from "../../hooks/useFocus";
import { useRemaining } from "../../hooks/useRemaining";
export function FloatingFocus({
  focus,
  onOpen,
  hidden,
}: {
  hidden: boolean;
  focus: FocusController;
  onOpen: () => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  useEffect(() => {
    const restore = () => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("todocal:focus-position") || "null",
        );
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y))
          setPosition({
            x: Math.max(8, Math.min(innerWidth - 72, saved.x)),
            y: Math.max(8, Math.min(innerHeight - 72, saved.y)),
          });
      } catch {}
    };
    restore();
    window.addEventListener("resize", restore);
    return () => window.removeEventListener("resize", restore);
  }, []);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const remaining = useRemaining(focus.active, focus.receivedAt);
  if (hidden) return null;
  return (
    <div
      className={cx("floating-focus-group")}
      style={
        position
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
    >
      <button
        className={cx("floating-focus", true)}
        aria-label="Focus timer"
        title="Focus timer · drag to move"
        onPointerDown={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            left: box.left,
            top: box.top,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
          if (d.moved)
            setPosition({
              x: Math.max(8, Math.min(innerWidth - 72, d.left + dx)),
              y: Math.max(8, Math.min(innerHeight - 72, d.top + dy)),
            });
        }}
        onPointerUp={() => {
          if (drag.current?.moved && position) {
            try {
              localStorage.setItem(
                "todocal:focus-position",
                JSON.stringify(position),
              );
            } catch {}
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClick={() => {
          if (!drag.current?.moved) onOpen();
          drag.current = null;
        }}
      >
        <Timer size={23} />
        {focus.active && <small>{timerLabel(remaining)}</small>}
      </button>
    </div>
  );
}
