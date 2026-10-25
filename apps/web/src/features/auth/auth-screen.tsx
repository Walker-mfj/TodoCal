"use client";
import { ValidatedForm } from "../../components/validated-form";
import { useState } from "react";
import Image from "next/image";
import todoCalLogo from "../../../assets/brand/todocal-logo.png";
import calendarCheckmark from "../../../assets/brand/calendar-checkmark.png";
import { useSession } from "../../app/providers";
import { ApiError, errorMessage } from "../../lib/api";
export function AuthScreen() {
  const { authenticate, loading, expired, connected } = useSession();
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (loading)
    return (
      <div className="loading" role="status">
        Opening your workspace…
      </div>
    );
  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="brand auth-brand" aria-label="TodoCal">
          <Image
            className="brand-wordmark"
            src={todoCalLogo}
            alt=""
            width={252}
            height={66}
          />
          <span className="brand-dark-wordmark" aria-hidden="true">
            <span className="brand-mark">
              <Image
                src={calendarCheckmark}
                alt=""
                width={36}
                height={36}
              />
            </span>
            <span>TodoCal</span>
          </span>
        </div>
        <p className="eyebrow">A little progress, every day.</p>
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
        <div className="auth-days" aria-hidden="true">
          {["M", "T", "W", "T", "F"].map((d, i) => (
            <span key={i} className={i < 3 ? "done" : ""}>
              {i < 3 ? "✓" : d}
            </span>
          ))}
        </div>
        <small>Your tasks, your pace. Pomodoro is always optional.</small>
      </section>
      <section className="auth-form">
        <p className="eyebrow">YOUR TODOCAL STARTS HERE</p>
        <h2>{register ? "Create your account" : "Welcome back"}</h2>
        <p className="muted">
          {register
            ? "One place for plans and progress."
            : "Sign in to your personal workspace."}
        </p>
        {expired && (
          <p role="status" className="notice">
            Your session expired. Sign in to resume your draft.
          </p>
        )}
        {!connected && (
          <p className="notice">
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
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              minLength={register ? 12 : 1}
              maxLength={128}
              required
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {register && <small>Use at least 12 characters.</small>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
          </button>
        </ValidatedForm>
        <button
          className="text-button"
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
