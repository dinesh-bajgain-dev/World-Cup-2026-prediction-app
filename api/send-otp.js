// api/send-otp.js  — Vercel serverless function
// Generates a 6-digit OTP, stores it in Supabase, and emails it via Brevo.
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, username } = req.body ?? {};
  if (!email) return res.status(400).json({ success: false, error: "email required" });

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Remove any previous unused codes for this email, then insert fresh one
  await supabase.from("email_verifications").delete().eq("email", email).eq("used", false);

  const { error: dbError } = await supabase
    .from("email_verifications")
    .insert({ email, code, expires_at: expiresAt });

  if (dbError) {
    console.error("[send-otp] DB error:", dbError.message);
    return res.status(500).json({ success: false, error: "Failed to create verification code" });
  }

  // Send via Brevo
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL;   // must be set — no fallback
  const SENDER_NAME   = process.env.BREVO_SENDER_NAME || "World Cup 2026 Predictor";
  const APP_URL       = process.env.VITE_APP_URL       || "https://wc2026predictor.com";

  if (!BREVO_API_KEY) {
    console.error("[send-otp] BREVO_API_KEY env var is not set");
    return res.status(500).json({ success: false, error: "Email service not configured (missing API key)" });
  }
  if (!SENDER_EMAIL) {
    console.error("[send-otp] BREVO_SENDER_EMAIL env var is not set");
    return res.status(500).json({ success: false, error: "Email service not configured (missing sender address)" });
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0f1117;padding:36px;border-radius:12px;color:#e5e7eb;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:46px;">🏆</div>
        <h2 style="color:#d4a853;margin:8px 0;font-size:22px;">FIFA World Cup 2026 Predictor</h2>
      </div>
      <p>Hi <strong>${username || email}</strong>,</p>
      <p>Here is your 6-digit verification code. It expires in <strong>10 minutes</strong>.</p>
      <div style="background:#1a1f2e;border:2px solid #d4a853;border-radius:10px;padding:24px;text-align:center;margin:28px 0;">
        <span style="font-size:42px;font-weight:900;letter-spacing:12px;color:#d4a853;font-family:monospace;">${code}</span>
      </div>
      <p style="font-size:13px;color:#9ca3af;">Enter this code on the registration page to verify your email and complete sign-up.</p>
      <p style="font-size:13px;color:#9ca3af;">If you didn't create an account, you can safely ignore this email.</p>
      <hr style="border-color:#374151;margin:24px 0;" />
      <p style="font-size:11px;color:#6b7280;text-align:center;">
        <a href="${APP_URL}" style="color:#d4a853;">World Cup 2026 Predictor</a>
      </p>
    </div>
  `;

  try {
    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email }],
        subject: "Your verification code — WC 2026 Predictor",
        htmlContent: html,
      }),
    });

    if (!brevoRes.ok) {
      const body = await brevoRes.text();
      console.error(`[send-otp] Brevo ${brevoRes.status} — sender:${SENDER_EMAIL} — body:`, body);
      // Parse Brevo's error message if available
      let brevoMessage = `HTTP ${brevoRes.status}`;
      try {
        const parsed = JSON.parse(body);
        brevoMessage = parsed.message || parsed.error || brevoMessage;
      } catch {}
      return res.status(500).json({
        success: false,
        error: `Email delivery failed: ${brevoMessage}`,
        debug: { status: brevoRes.status, sender: SENDER_EMAIL },
      });
    }

    console.log(`[send-otp] ✅ OTP sent to ${email}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[send-otp] fetch error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
