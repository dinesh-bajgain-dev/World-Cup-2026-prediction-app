import { createContext, useContext, useEffect, useState } from "react";
import { supabase, getProfile, ensureProfile } from "../lib/supabase";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

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
