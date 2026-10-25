"use client";
import { useRef, useState } from "react";
import { Timer } from "lucide-react";
import { timerLabel } from "./clock";
import type { FocusController } from "./useFocus";
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
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  if (hidden) return null;
  return (
    <div
      className="floating-focus-group"
      style={
        position
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
    >
      <button
        className="floating-focus"
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
        onPointerCancel={() => {
          drag.current = null;
        }}
        onClick={() => {
          if (!drag.current?.moved) onOpen();
          drag.current = null;
        }}
      >
        <Timer size={23} />
        {focus.active && <small>{timerLabel(focus.remaining)}</small>}
      </button>
    </div>
  );
}
