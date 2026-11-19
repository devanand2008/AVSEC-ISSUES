"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle, WifiOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CollegeBranding } from "@/components/college-branding";
import { CampusBackground } from "@/components/campus-background";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import { loginErrorMessage } from "./login-error";
import { probeLoginReadiness, type LoginReadiness } from "./login-readiness";
import { getPostAuthenticationRoute } from "@/features/auth/post-login-routing";
import { qrRouteAfterSignIn } from "@/features/auth/qr-sign-in";
import styles from "./login.module.css";

type LoginHint = {
  identifier: string;
  collegeCode: string;
  remember: boolean;
};

function readLoginHint(): LoginHint {
  const emptyHint = { identifier: "", collegeCode: "", remember: false };
  if (typeof window === "undefined") return emptyHint;
  try {
    const saved = window.localStorage.getItem("avs_login_hint");
    if (!saved) return emptyHint;
    const parsed = JSON.parse(saved);
    return {
      identifier: typeof parsed?.identifier === "string" ? parsed.identifier : "",
      collegeCode: typeof parsed?.collegeCode === "string" ? parsed.collegeCode : "",
      remember: true,
    };
  } catch {
    return emptyHint;
  }
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [savedHint] = useState(readLoginHint);
  const [identifier, setIdentifier] = useState(savedHint.identifier);
  const [password, setPassword] = useState("");
  const [collegeCode, setCollegeCode] = useState(savedHint.collegeCode);
  const [remember, setRemember] = useState(savedHint.remember);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState<LoginReadiness | "checking">(
    "checking",
  );
  const readinessRunning = useRef(false);
  const checkConnection = useCallback(async () => {
    if (readinessRunning.current) return;
    readinessRunning.current = true;
    setReadiness("checking");
    const result = await probeLoginReadiness(() => api.warmup(), { attempts: 1 });
    setReadiness(navigator.onLine ? result : "offline");
    readinessRunning.current = false;
  }, []);
  useEffect(() => {
    const warmServer = () => void checkConnection();
    const markOffline = () => setReadiness("offline");
    warmServer();
    window.addEventListener("online", warmServer);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", warmServer);
      window.removeEventListener("offline", markOffline);
    };
  }, [checkConnection]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!navigator.onLine) {
      setReadiness("offline");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const user = await login(
        identifier.trim(),
        password,
        collegeCode.trim() || undefined,
      );
      try {
        if (remember)
          window.localStorage.setItem(
            "avs_login_hint",
            JSON.stringify({ identifier: identifier.trim(), collegeCode: collegeCode.trim() }),
          );
        else window.localStorage.removeItem("avs_login_hint");
      } catch {
        // Some browser privacy settings disable storage. Sign-in still works.
      }
      const landing = getPostAuthenticationRoute(user);
      router.push(landing === "/" ? qrRouteAfterSignIn(window.location.search) : landing);
    } catch (caught: unknown) {
      setError(loginErrorMessage(caught));
      setBusy(false);
    }
  }
  return (
    <main className={styles.page} data-login-page>
      <aside className={styles.brandPanel}>
        <CampusBackground dark showCollegeLogo />
        <CollegeBranding priority />
        <div className={styles.brandCopy}>
          <p className={styles.brandTitle}>Campus services</p>
          <p className={styles.brandDescription}>
            Check attendance, read announcements, get in touch, and report
            campus issues.
          </p>
        </div>
        <span className={styles.brandFooter}>For students, faculty, and staff</span>
      </aside>

      <section className={styles.formPanel} aria-labelledby="login-title">
        <CampusBackground />
        <div className={styles.formWrap}>
          <CollegeBranding className={styles.mobileBrand} priority />
          <header className={styles.formHeader}>
            <h1 id="login-title">Sign in</h1>
            <p>Use your college ID or the email registered with AVS.</p>
          </header>

          <form className={styles.form} onSubmit={submit} aria-busy={busy}>
            {error && <div className="error-box" role="alert">{error}</div>}

            <div className="field">
              <label htmlFor="identifier">College ID or Email</label>
              <input
                className="input"
                id="identifier"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                required
              />
            </div>

            <div className="field">
              <div className={styles.passwordLabel}>
                <label htmlFor="password">Password</label>
                <Link className={styles.recoveryLink} href="/forgot-password">
                  Forgot password?
                </Link>
              </div>
              <div className={styles.passwordField}>
                <input
                  className="input"
                  id="password"
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  className={styles.showPassword}
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Hide password" : "Show password"}
                  aria-controls="password"
                >
                  {visible ? <EyeOff size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="collegeCode">
                College code <span className={styles.optional}>(if requested)</span>
              </label>
              <input
                className="input"
                id="collegeCode"
                name="collegeCode"
                autoCapitalize="characters"
                spellCheck={false}
                value={collegeCode}
                onChange={(event) => setCollegeCode(event.target.value.toUpperCase())}
              />
            </div>

            <label className={`check-field ${styles.remember}`}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Remember my ID on this device
            </label>

            {(readiness === "offline" || (busy && readiness === "checking")) && (
              <div className={styles.connection}>
                {readiness === "checking" ? (
                  <LoaderCircle className={styles.spinner} size={19} aria-hidden />
                ) : (
                  <WifiOff size={19} aria-hidden />
                )}
                <div>
                  <span role="status">
                    {readiness === "offline"
                      ? "You’re offline. Reconnect to sign in."
                      : "Connecting to the campus server…"}
                  </span>
                </div>
              </div>
            )}

            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Signing in…" : "Secure sign in"}
              {!busy && <ArrowRight size={18} aria-hidden />}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
