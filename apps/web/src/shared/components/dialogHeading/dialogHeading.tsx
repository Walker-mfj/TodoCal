import { bindStyles } from "../../utils/classNames";
import styles from "./dialogHeading.module.css";
const cx = bindStyles(styles);
import { X, type LucideIcon } from "lucide-react";

export function DialogHeading({
  id,
  title,
  icon: Icon,
  destructive = false,
  onClose,
  disabled = false,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  destructive?: boolean;
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={cx("app-dialog-heading")}>
      <span
        className={cx(`app-dialog-icon${destructive ? " destructive" : ""}`)}
      >
        <Icon size={20} aria-hidden="true" />
      </span>
      <h2 id={id}>{title}</h2>
      <button
        type="button"
        className={cx("app-dialog-close icon-button", true)}
        aria-label="Close dialog"
        disabled={disabled}
        onClick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
