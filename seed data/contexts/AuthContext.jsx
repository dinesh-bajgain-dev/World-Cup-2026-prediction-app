import { createContext, useContext, useEffect, useState } from "react";
import { supabase, getProfile, ensureProfile } from "../lib/supabase";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin;

const sendWelcomeEmail = async (email, username) => {
  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        subject: "Welcome to World Cup 2026 Predictor!",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f1117;color:#e5e7eb;padding:32px;border-radius:12px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="font-size:48px;">🏆</div>
              <h1 style="color:#d4a853;font-size:24px;margin:8px 0;">FIFA World Cup 2026 Predictor</h1>
            </div>
            <p>Hi <strong>${username || "there"}</strong>,</p>
            <p>You're in! Start predicting matches, climb the global leaderboard, and prove you know football.</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${APP_URL}" style="display:inline-block;background:#d4a853;color:#000;padding:13px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">Start Predicting →</a>
            </div>
            <p style="color:#6b7280;font-size:12px;">Best of luck,<br>The WC 2026 Team</p>
          </div>
        `,
      }),
    });
    const data = await res.json();
    if (!data.success) console.warn("[welcome-email] failed:", data.error);
  } catch (err) {
    console.error("[welcome-email] API error:", err);
  }
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id, session.user);
      else setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id, session.user);
      else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (uid, user = null) => {
    const { data, error } = await getProfile(uid);
    if (error || !data) {
      const { data: createdProfile, error: createError } = await ensureProfile(
        uid,
        user?.user_metadata?.username || user?.email?.split("@")[0] || "user",
      );
      if (createError) {
        console.error("Unable to create profile", createError);
      }
      setProfile(createdProfile);
    } else {
      setProfile(data);
    }
    setLoading(false);
  };

  const refreshProfile = () =>
    session && fetchProfile(session.user.id, session.user);

  return (
    <AuthCtx.Provider
      value={{
        session,
        profile,
        loading,
        refreshProfile,
        isAdmin: profile?.role === "admin",
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
