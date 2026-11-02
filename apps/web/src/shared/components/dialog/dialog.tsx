"use client";
import { bindStyles } from "../../utils/classNames";
import styles from "./dialog.module.css";
const cx = bindStyles(styles);

import { useEffect, useId, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { DialogHeading } from "../dialogHeading/dialogHeading";

/** Mount while open; the owner handles the decision and unmounts on dismissal. */
export function Dialog({
  title,
  icon,
  description,
  children,
  actions,
  onDismiss,
  cancelLabel = "Cancel",
  busy = false,
  destructive = false,
  role = "dialog",
}: {
  title: string;
  icon: LucideIcon;
  description: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  onDismiss: () => void;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  role?: "dialog" | "alertdialog";
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const outsidePointer = useRef(false);
  useEffect(() => {
    const element = dialog.current!;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.showModal();
    if (!cancel.current?.disabled) cancel.current?.focus();
    return () => {
      element.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const dismiss = () => {
    if (!busy) onDismiss();
  };
  return (
    <dialog
      ref={dialog}
      className={cx("app-dialog")}
      role={role}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        outsidePointer.current =
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom);
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom);
        if (outsidePointer.current && outside) dismiss();
        outsidePointer.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) dismiss();
          return;
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) =>
            !element.matches(":disabled") &&
            !element.closest("[hidden], [inert]") &&
            getComputedStyle(element).display !== "none" &&
            getComputedStyle(element).visibility !== "hidden",
        );
        // Explicit traversal also includes buttons when WebKit's platform
        // keyboard preference otherwise skips them inside the modal.
        event.preventDefault();
        if (!controls.length) return;
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next =
          current < 0
            ? event.shiftKey
              ? controls.length - 1
              : 0
            : (current + (event.shiftKey ? -1 : 1) + controls.length) %
              controls.length;
        controls[next].focus();
      }}
    >
      <DialogHeading
        id={`${id}-title`}
        title={title}
        icon={icon}
        destructive={destructive}
        onClose={dismiss}
        disabled={busy}
      />
      <p id={`${id}-description`}>{description}</p>
      {children}
      <div className={cx("app-dialog-actions")}>
        <button
          ref={cancel}
          type="button"
          disabled={busy}
          onClick={dismiss}
          className={cx("", true)}
        >
          {cancelLabel}
        </button>
        {actions}
      </div>
    </dialog>
  );
}
