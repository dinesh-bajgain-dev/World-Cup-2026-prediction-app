import { createContext, useContext, useEffect, useState } from "react";
import { supabase, getProfile, ensureProfile } from "../lib/supabase";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Add this helper function at the top of your file (outside the component)
const sendWelcomeEmail = async (email) => {
  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        subject: "Welcome to World Cup Predictor! 🏆",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #2563eb;">Welcome to World Cup Predictor!</h1>
            <p>Hi there,</p>
            <p>Thanks for joining the ultimate World Cup 2026 prediction game.</p>
            <p>Start predicting matches now and climb the leaderboard to win!</p>
            <a href="https://your-production-url.com" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;">Start Predicting</a>
            <p style="margin-top: 20px; color: #666; font-size: 12px;">
              Best,<br>The World Cup Team
            </p>
          </div>
        `,
      }),
    });

    const data = await res.json();
    if (!data.success) {
      console.warn("Welcome email failed:", data.error);
      // Don't block signup if email fails
    }
  } catch (err) {
    console.error("Email API error:", err);
  }
};

// Inside your signUp function, AFTER successful signup:
export const signUp = async (email, password, username) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) throw error;

  // ✅ Send Brevo welcome email if signup succeeded
  if (data?.user?.email) {
    await sendWelcomeEmail(data.user.email);
  }

  return { data, error };
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
