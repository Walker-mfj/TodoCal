"use client";
import { bindStyles } from "../../utils/classNames";
import styles from "./validatedForm.module.css";
const cx = bindStyles(styles);

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function message(field: Field) {
  const label =
    Array.from(field.labels?.[0]?.childNodes || [])
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join("")
      .trim() || "This field";
  const validity = field.validity;
  if (validity.valueMissing) return `${label} is required.`;
  if (validity.typeMismatch)
    return `Enter a valid ${field instanceof HTMLInputElement && field.type === "email" ? "email address" : label.toLowerCase()}.`;
  if (field instanceof HTMLInputElement) {
    if (validity.rangeUnderflow)
      return `${label} must be at least ${field.min}.`;
    if (validity.rangeOverflow)
      return `${label} must be no more than ${field.max}.`;
    if (validity.tooShort)
      return `${label} must contain at least ${field.minLength} characters.`;
  }
  return `Check ${label.toLowerCase()} and enter a valid value.`;
}
export function ValidatedForm({
  children,
  onSubmit,
  fieldError,
  ...props
}: ComponentProps<"form"> & {
  fieldError?: { field: string; message: string } | null;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const id = useId();
  const invalid = useRef<Field | null>(null);
  const clear = () => {
    invalid.current?.removeAttribute("aria-invalid");
    invalid.current?.removeAttribute("aria-describedby");
    invalid.current = null;
    setError("");
  };
  const show = useCallback(
    (field: Field, text: string) => {
      invalid.current = field;
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", id);
      if (!field.hasAttribute("aria-label")) {
        const label = Array.from(field.labels?.[0]?.childNodes || [])
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join("")
          .trim();
        if (label) field.setAttribute("aria-label", label);
      }
      setHost(field.parentElement);
      setError(text);
      field.focus();
    },
    [id],
  );
  useEffect(() => {
    if (!fieldError) return;
    const field = form.current?.elements.namedItem(fieldError.field);
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    )
      show(field, fieldError.message);
  }, [fieldError, show]);
  return (
    <form
      ref={form}
      {...props}
      noValidate
      onInvalid={(e) => e.preventDefault()}
      onInput={clear}
      onSubmit={(e) => {
        clear();
        const field = Array.from(e.currentTarget.elements).find(
          (element) =>
            (element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement) &&
            !element.validity.valid &&
            element.willValidate,
        ) as Field | undefined;
        if (field) {
          e.preventDefault();
          show(field, message(field));
          return;
        }
        onSubmit?.(e);
      }}
    >
      {error &&
        host &&
        createPortal(
          <span id={id} className={cx("error field-error")} role="alert">
            {error}
          </span>,
          host,
        )}
      {children}
    </form>
  );
}
