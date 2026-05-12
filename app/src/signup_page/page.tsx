"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import { getAuthErrorMessage, logErrorForDebug } from "../../lib/errorHandler";
import styles from "./index.module.css";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signUp, signInWithGoogle } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      await signUp(email, password);
      router.push("/src/main_page");
    } catch (err) {
      logErrorForDebug(err, 'Signup.handleSubmit');
      const errorMessage = err instanceof Error ? getAuthErrorMessage(err) : "Unable to create account. Please try again.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setLoading(true);

    try {
      await signInWithGoogle();
      router.push("/src/main_page");
    } catch (err) {
      logErrorForDebug(err, 'Signup.handleGoogleSignIn');
      const errorMessage = err instanceof Error ? getAuthErrorMessage(err) : "Unable to sign in with Google. Please try again.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <Link href="/src/landing_page" className={styles.logoLink} aria-label="Back to Tuff">
        ← Back
      </Link>
      <div className={styles.left}>
        <div className={styles.card}>
          <h1 className={styles.title}>Create Account</h1>
          <p className={styles.subtitle}>Get started with Tuff</p>
    
          {error && <div className={styles.error}>{error}</div>}

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.inputGroup}>
              <label htmlFor="email" className={styles.label}>
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.input}
                placeholder="Enter your email"
                required
              />
            </div>

            <div className={styles.inputGroup}>
              <label htmlFor="password" className={styles.label}>
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.input}
                placeholder="Create a password"
                required
              />
            </div>

            <div className={styles.inputGroup}>
              <label htmlFor="confirmPassword" className={styles.label}>
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={styles.input}
                placeholder="Confirm your password"
                required
              />
            </div>

            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading}
            >
              {loading ? "Creating account..." : "Sign Up"}
            </button>
          </form>

          <div className={styles.divider}>
            <span>or</span>
          </div>

          <button
            onClick={handleGoogleSignIn}
            className={styles.googleButton}
            disabled={loading}
          >
            <svg className={styles.googleIcon} viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          <p className={styles.linkText}>
            Already have an account?{" "}
            <Link href="/src/login_page" className={styles.link}>
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.brand}>
          <span>KNOW ABOUT WERE YOU SPEND</span>
          <h1>Tuff: Your AI-Powered Cloud Cost Optimizer</h1>
          <p>
            Tuff analyzes and provides insights into your cloud spending, helping you optimize 
            costs and improve efficiency.
          </p>
        </div>
      </div>
    </div>
  );
}