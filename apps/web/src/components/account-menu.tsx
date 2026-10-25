"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronUp, Wifi, WifiOff } from "lucide-react";
export function AccountMenu({
  email,
  connected,
  children,
}: {
  email: string;
  connected: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const place = () => {
    if (!trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    panel.current.style.width = `${width}px`;
    panel.current.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
    panel.current.style.top = `${Math.max(12, Math.min(anchor.top - panel.current.offsetHeight - 8, window.innerHeight - panel.current.offsetHeight - 12))}px`;
  };
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  return (
    <div className="account-control">
      <button
        ref={trigger}
        className="account-trigger"
        popoverTarget={id}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Account: ${email}`}
        title={email}
      >
        <span className="account-avatar" aria-hidden="true">
          {email.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-trigger-email">{email}</span>
        <ChevronUp className="account-chevron" size={16} />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        className="account-popover"
        role="dialog"
        aria-label="Account options"
        onToggle={(event) => {
          setOpen(event.newState === "open");
          if (event.newState === "open") place();
        }}
      >
        <div className="account-popover-heading">
          <strong>{email}</strong>
          <span>
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}{" "}
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
