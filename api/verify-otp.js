// api/verify-otp.js  — Vercel serverless function
// Validates the 6-digit OTP against Supabase, marks it as used on success.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, code } = req.body ?? {};
  if (!email || !code) {
    return res.status(400).json({ success: false, error: "email and code required" });
  }

  const { data, error } = await supabase
    .from("email_verifications")
    .select("id, expires_at, used")
    .eq("email", email)
    .eq("code", code.trim())
    .eq("used", false)
    .maybeSingle();

  if (error) {
    console.error("[verify-otp] DB error:", error.message);
    return res.status(500).json({ success: false, error: "Verification check failed" });
  }

  if (!data) {
    return res.status(200).json({ success: false, error: "Invalid code — check the code and try again" });
  }

  if (new Date(data.expires_at) < new Date()) {
    return res.status(200).json({ success: false, error: "Code has expired — request a new one" });
  }

  // Mark as used
  await supabase.from("email_verifications").update({ used: true }).eq("id", data.id);

  console.log(`[verify-otp] ✅ Verified ${email}`);
  return res.status(200).json({ success: true });
}
