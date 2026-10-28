"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function SidebarPanel({
  label,
  eyebrow,
  title,
  closeLabel = "Close panel",
  className = "",
  disabled = false,
  onClose,
  children,
}: {
  label: string;
  eyebrow: string;
  title?: string;
  closeLabel?: string;
  className?: string;
  disabled?: boolean;
  onClose: () => void | Promise<void>;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        disabled
      )
        return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      if (
        typeof CSS !== "undefined" &&
        CSS.supports?.("selector(:popover-open)") &&
        document.querySelector(":popover-open")
      )
        return;
      const panels = document.querySelectorAll("[data-sidebar-panel]");
      if (panels[panels.length - 1] !== panel.current) return;
      if (event.target instanceof HTMLSelectElement) {
        event.target.blur();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [disabled, onClose]);
  return (
    <aside
      ref={panel}
      data-sidebar-panel
      className={`detail-panel ${className}`.trim()}
      aria-label={label}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          {title && <h2>{title}</h2>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={closeLabel}
          disabled={disabled}
          onClick={() => void onClose()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {children}
    </aside>
  );
}
