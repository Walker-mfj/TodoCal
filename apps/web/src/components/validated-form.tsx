"use client";
import { useId, useRef, useState, type ComponentProps } from "react";
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
  ...props
}: ComponentProps<"form">) {
  const [error, setError] = useState("");
  const id = useId();
  const invalid = useRef<Field | null>(null);
  const clear = () => {
    invalid.current?.removeAttribute("aria-invalid");
    invalid.current?.removeAttribute("aria-describedby");
    invalid.current = null;
    setError("");
  };
  return (
    <form
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
          invalid.current = field;
          field.setAttribute("aria-invalid", "true");
          field.setAttribute("aria-describedby", id);
          setError(message(field));
          field.focus();
          return;
        }
        onSubmit?.(e);
      }}
    >
      {error && (
        <div id={id} className="error form-validation" role="alert">
          <strong>Please check this field</strong>
          <span>{error}</span>
        </div>
      )}
      {children}
    </form>
  );
}
