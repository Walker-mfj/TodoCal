import { useEffect, useId, useRef, useState } from "react";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./timezonePicker.module.css";
const cx = bindStyles(styles);
const commonZones = [
  "UTC",
  "Asia/Tokyo",
  "Asia/Ho_Chi_Minh",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];
const normalize = (value: string) => value.toLowerCase().replaceAll("_", " ");

export function TimezonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (zone: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [zones, setZones] = useState(commonZones);
  const [device, setDevice] = useState("");
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    setDevice(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (typeof Intl.supportedValuesOf === "function") {
      setZones(Intl.supportedValuesOf("timeZone"));
    }
  }, []);
  const options = [...new Set([...zones, ...commonZones, value, device])]
    .filter((zone) => zone && normalize(zone).includes(normalize(search ?? "")))
    .sort();
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const close = () => {
    setOpen(false);
    setSearch(null);
    setActive(-1);
  };
  const choose = (zone: string) => {
    onChange(zone);
    close();
  };
  return (
    <div className={cx("picker")}>
      <label htmlFor={id} className={cx("", true)}>
        Timezone
      </label>
      <div className={cx("control")}>
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && active >= 0 ? `${id}-option-${active}` : undefined
          }
          autoComplete="off"
          className={cx("", true)}
          value={search ?? value}
          onFocus={() => {
            setOpen(true);
            setActive(-1);
          }}
          onClick={() => setOpen(true)}
          onBlur={close}
          onChange={(e) => {
            setSearch(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((index) =>
                options.length
                  ? index < 0
                    ? e.key === "ArrowDown"
                      ? 0
                      : options.length - 1
                    : (index +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        options.length) %
                      options.length
                  : -1,
              );
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              if (active >= 0 && options[active]) choose(options[active]);
              else if (options.length === 1) choose(options[0]);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        />
        {open && (
          <div className={cx("dropdown")}>
            <ul
              id={`${id}-list`}
              role="listbox"
              tabIndex={-1}
              aria-label="Timezones"
              ref={list}
              className={cx("options")}
            >
              {options.map((zone, index) => (
                <li
                  key={zone}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={zone === value}
                  className={cx(index === active ? "active" : "option")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(zone)}
                >
                  {zone}
                </li>
              ))}
            </ul>
            {!options.length && <p role="status">No matching timezone.</p>}
          </div>
        )}
      </div>
      <button
        type="button"
        className={cx("device", true)}
        disabled={!device}
        onClick={() => choose(device)}
      >
        Use device timezone
      </button>
      {device && (
        <small className={cx("hint")}>
          Device: {device}. Apply with Save changes.
        </small>
      )}
    </div>
  );
}
