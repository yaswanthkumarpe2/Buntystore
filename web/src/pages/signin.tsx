import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { api, ApiError, type User } from "../api";
import { useStore } from "../state";
import { BuntyLogo } from "../logo";
import { Link, useNav } from "../nav";
import { Alert, Button, Card } from "../ui";

const field =
  "h-12 w-full rounded-xl border border-line bg-surface px-3 text-[15px] transition-colors focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand-50";

/** Problems Google sign-in can come back with, in plain words. */
const GOOGLE_ERRORS: Record<string, string> = {
  google: "Signing in with Google did not work. Please try again.",
  google_cancelled: "Google sign-in was cancelled.",
  google_unverified: "Your Google account's email is not verified, so it cannot be used here.",
};

/** Google's mark, in Google's own colours (their brand rules ask for exactly these). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="var(--color-google-red)" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="var(--color-google-blue)" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="var(--color-google-yellow)" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="var(--color-google-green)" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

type Step = "email" | "code" | "name" | "password";

/**
 * One page for signing in and signing up: Continue with Google, or an email
 * code (a new address becomes an account after the code). A password stays
 * available for accounts that have one.
 */
export function AuthPage({ mode }: { mode: "signin" | "signup" }) {
  const { user, ready, emailSignIn, googleSignIn, passwordReset, signIn, sendCode, verifyCode, notify } = useStore();
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/") && !params.get("next")!.startsWith("//") ? params.get("next")! : "/";
  const nav = useNav();

  const [chosen, setStep] = useState<Step>("email");
  // without email the only ways in are a password and Google
  const step: Step = ready && !emailSignIn ? "password" : chosen;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => GOOGLE_ERRORS[params.get("error") ?? ""] ?? null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (user) nav(next, { replace: true });
  }, [user, next, nav]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const askForCode = (e?: FormEvent) => {
    e?.preventDefault();
    void run(async () => {
      setResendIn(await sendCode(email));
      setCode("");
      go("code");
    });
  };

  const checkCode = (value: string, withName?: string) =>
    run(async () => {
      const result = await verifyCode(email, value, withName);
      if (result === "name") go("name");
      else notify(withName ? "Welcome to Bunty Store!" : "Signed in");
    });

  const heading =
    step === "name"
      ? "Nice to meet you"
      : step === "code"
        ? "Check your email"
        : step === "password"
          ? "Sign in with your password"
          : mode === "signup"
            ? "Create your account"
            : "Sign in or create an account";
  const sub =
    step === "name"
      ? "One last thing: what should we call you?"
      : step === "code"
        ? <>We sent a 6-digit code to <strong className="text-ink">{email}</strong>.</>
        : "Shopping, orders and returns, all in one place.";

  return (
    <div className="mx-auto max-w-md py-4 sm:py-8">
      <Link to="/" className="mb-5 flex justify-center" aria-label="Bunty Store home">
        <BuntyLogo className="h-16 w-auto" />
      </Link>
      <Card className="!p-6 sm:!p-8">
        <div key={step} className="animate-rise">
          <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>
          <p className="mt-1.5 text-sm text-ink-2">{sub}</p>

          {(step === "email" || step === "password") && googleSignIn && (
            <>
              <a
                href={`/api/auth/google?next=${encodeURIComponent(next)}`}
                className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-line bg-surface text-[15px] font-semibold text-ink transition hover:bg-canvas active:scale-[0.99]"
              >
                <GoogleMark />
                Continue with Google
              </a>
              <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-ink-3" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          )}

          {step === "email" && (
            <form className={`space-y-3 ${googleSignIn ? "" : "mt-6"}`} onSubmit={askForCode}>
              <Labelled label="Email">
                <input required type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={field} placeholder="you@example.com" />
              </Labelled>
              {error && <Alert>{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending your code…" : "Continue with email"}</Button>
              <p className="text-center text-xs text-ink-3">We'll email you a code. No password needed, new or returning.</p>
            </form>
          )}

          {step === "code" && (
            <form
              className="mt-6 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void checkCode(code);
              }}
            >
              <CodeInput
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (v.length === 6 && !busy) void checkCode(v);
                }}
              />
              {error && <Alert>{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Continue"}</Button>
              <div className="flex items-center justify-between pt-1 text-sm">
                <button type="button" className="font-semibold text-brand hover:underline" onClick={() => go("email")}>Use a different email</button>
                {resendIn > 0 ? (
                  <span className="text-ink-3">Send again in {resendIn}s</span>
                ) : (
                  <button type="button" className="font-semibold text-brand hover:underline" disabled={busy} onClick={() => askForCode()}>Send a new code</button>
                )}
              </div>
              <p className="text-xs text-ink-3">The code works for 10 minutes. Can't find it? Check your spam folder.</p>
            </form>
          )}

          {step === "name" && (
            <form
              className="mt-6 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void checkCode(code, name);
              }}
            >
              <Labelled label="Your name">
                <input required minLength={2} autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} />
              </Labelled>
              {error && <Alert>{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating your account…" : "Create account"}</Button>
            </form>
          )}

          {step === "password" && (
            <form
              className={`space-y-3 ${googleSignIn ? "" : "mt-6"}`}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await signIn(email, password);
                  notify("Signed in");
                });
              }}
            >
              <Labelled label="Email">
                <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={field} />
              </Labelled>
              <Labelled label="Password">
                <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
              </Labelled>
              {passwordReset && (
                <p className="text-right text-sm">
                  <Link to="/forgot-password" className="font-semibold text-brand hover:underline">Forgot password?</Link>
                </p>
              )}
              {error && <Alert>{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
              {emailSignIn && (
                <p className="pt-1 text-center text-sm">
                  <button type="button" className="font-semibold text-brand hover:underline" onClick={() => go("email")}>Use an email code instead</button>
                </p>
              )}
            </form>
          )}
        </div>
      </Card>
      <p className="mt-4 text-center text-xs text-ink-3">
        Your session is kept in a secure cookie.{googleSignIn && " We never see your Google password."}
      </p>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}

/** One field for the 6 digits: phones offer the code from the email, and pasting works. */
function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <label className="block">
      <span className="sr-only">6-digit code</span>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="••••••"
        className={`${field} h-14 text-center font-mono text-2xl font-bold tracking-[0.5em] placeholder:tracking-[0.5em] placeholder:text-line`}
      />
    </label>
  );
}

function PasswordInput({
  value,
  onChange,
  autoComplete,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input
        required
        type={shown ? "text" : "password"}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className={`${field} pr-16`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2 text-sm font-semibold text-brand hover:bg-brand-50"
        aria-label={shown ? "Hide password" : "Show password"}
      >
        {shown ? "Hide" : "Show"}
      </button>
    </span>
  );
}

/** How strong a new password looks: a quick guide, not a rule (the server turns down the easy ones). */
function strength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < 8) return { score: 0, label: "At least 8 characters" };
  let points = 0;
  if (pw.length >= 12) points++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points++;
  if (/\d/.test(pw)) points++;
  if (/[^A-Za-z0-9]/.test(pw)) points++;
  if (points <= 1) return { score: 1, label: "Weak: make it longer or mix in numbers and symbols" };
  if (points === 2) return { score: 2, label: "Good" };
  return { score: 3, label: "Strong" };
}

// ---------------------------------------------------------------- account: security

/** Ways to sign in, a password to add or change, and signing out other devices. */
export function SecurityCard({ user, onUser }: { user: User; onUser: (u: User) => void }) {
  const { emailSignIn, googleSignIn, notify } = useStore();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = strength(next);

  return (
    <Card>
      <h2 className="text-lg font-bold">Sign-in and security</h2>
      <ul className="mt-3 divide-y divide-line">
        {emailSignIn && <Method name="Email code" detail={`A code sent to ${user.email}`} on />}
        {(googleSignIn || user.google) && (
          <Method name="Google" detail={user.google ? "Connected" : "Use Continue with Google with this email to connect it"} on={user.google} />
        )}
        {/* sign-in is by email code (or Google); only accounts that already have a password still see it */}
        {user.hasPassword && <Method name="Password" detail="Set" on />}
      </ul>

      {!open ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {user.hasPassword && <Button variant="ghost" onClick={() => setOpen(true)}>Change password</Button>}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/auth/sign-out-everywhere", { method: "POST" });
                notify("Signed out on every other device");
              } catch (e) {
                notify(e instanceof ApiError ? e.message : "Could not sign out other devices.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign out everywhere else
          </Button>
        </div>
      ) : (
        <form
          className="animate-rise mt-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await api<{ user: User }>("/auth/password", {
                method: "POST",
                body: user.hasPassword ? { current, password: next } : { password: next },
              });
              onUser(r.user);
              notify(user.hasPassword ? "Password changed. Other devices were signed out." : "Password added");
              setOpen(false);
              setCurrent("");
              setNext("");
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "Could not save the password.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {user.hasPassword && (
            <Labelled label="Current password">
              <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
            </Labelled>
          )}
          <Labelled label={user.hasPassword ? "New password" : "Password"}>
            <PasswordInput value={next} onChange={setNext} autoComplete="new-password" autoFocus={!user.hasPassword} />
          </Labelled>
          <div aria-live="polite">
            <div className="flex gap-1" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${s.score >= i ? (s.score === 1 ? "bg-bad" : s.score === 2 ? "bg-warn" : "bg-ok") : "bg-line"}`}
                />
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-3">{s.label}</p>
          </div>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || next.length < 8}>{busy ? "Saving…" : "Save password"}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Method({ name, detail, on }: { name: string; detail: string; on: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <span>
        <span className="block font-semibold">{name}</span>
        <span className="block text-sm text-ink-3">{detail}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${on ? "bg-ok-50 text-ok" : "bg-canvas text-ink-3"}`}>{on ? "On" : "Off"}</span>
    </li>
  );
}
