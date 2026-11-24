"use client";
import { Skeleton } from "../../../../shared/components/skeleton/skeleton";
import { bindStyles } from "../../../../shared/utils/classNames";
import styles from "./authScreen.module.css";
const cx = bindStyles(styles);

import { ValidatedForm } from "../../../../shared/components/validatedForm/validatedForm";
import { useState } from "react";
import Image from "next/image";
import todoCalLogo from "../../../../../assets/brand/todocalLogo.png";
import calendarCheckmark from "../../../../../assets/brand/calendarCheckmark.png";
import { useSession } from "../sessionProvider/sessionProvider";
import { ApiError, errorMessage } from "../../../../shared/api/apiClient";
export function AuthScreen() {
  const { authenticate, loading, expired, connected } = useSession();
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (loading)
    return (
      <div className={cx("loading")} role="status">
        <span
          role="status"
          aria-label="Opening your workspace…"
          aria-live="polite"
        >
          <span
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              clipPath: "inset(50%)",
            }}
            className="sr-only"
          >
            Opening your workspace…
          </span>
          <Skeleton width="70%" height={20} />
          <Skeleton width="95%" height={14} />
        </span>
      </div>
    );
  return (
    <main className={cx("auth-page")}>
      <section className={cx("auth-intro")}>
        <div className={cx("brand auth-brand")} role="img" aria-label="TodoCal">
          <Image
            className={cx("brand-wordmark")}
            src={todoCalLogo}
            alt=""
            width={252}
            height={66}
          />
          <span className={cx("brand-dark-wordmark")} aria-hidden="true">
            <span className={cx("brand-mark")}>
              <Image src={calendarCheckmark} alt="" width={36} height={36} />
            </span>
            <span>TodoCal</span>
          </span>
        </div>
        <p className={cx("eyebrow")}>A little progress, every day.</p>
        <h1>
          Make room for
          <br />
          what matters.
        </h1>
        <p>
          Plan your week. Find your focus.
          <br />
          See how far you’ve come.
        </p>
        <div className={cx("auth-days")} aria-hidden="true">
          {["M", "T", "W", "T", "F"].map((d, i) => (
            <span key={i} className={cx(i < 3 ? "done" : "")}>
              {i < 3 ? "✓" : d}
            </span>
          ))}
        </div>
        <small>Your tasks, your pace. Pomodoro is always optional.</small>
      </section>
      <section className={cx("auth-form")}>
        <p className={cx("eyebrow")}>YOUR TODOCAL STARTS HERE</p>
        <h2>{register ? "Create your account" : "Welcome back"}</h2>
        <p className={cx("muted")}>
          {register
            ? "One place for plans and progress."
            : "Sign in to your personal workspace."}
        </p>
        {expired && (
          <p role="status" className={cx("notice")}>
            Your session expired. Sign in to resume your draft.
          </p>
        )}
        {!connected && (
          <p className={cx("notice")}>
            Connection unavailable. Check that the API is running.
          </p>
        )}
        <ValidatedForm
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await authenticate(email, password, register);
            } catch (err) {
              setError(
                err instanceof ApiError ? err.message : errorMessage(err),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className={cx("", true)}>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cx("", true)}
            />
          </label>
          <label className={cx("", true)}>
            Password
            <input
              type="password"
              minLength={register ? 12 : 1}
              maxLength={128}
              required
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cx("", true)}
            />
          </label>
          {register && <small>Use at least 12 characters.</small>}
          {error && (
            <p role="alert" className={cx("error")}>
              {error}
            </p>
          )}
          <button className={cx("primary wide", true)} disabled={busy}>
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
          </button>
        </ValidatedForm>
        <button
          className={cx("text-button", true)}
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register ? "Already have an account? Sign in" : "Create an account"}
        </button>
      </section>
    </main>
  );
}
