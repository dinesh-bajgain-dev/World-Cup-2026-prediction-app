// api/debug-brevo.js — diagnostic endpoint to surface exact Brevo errors
// DELETE or lock behind auth before going public.
// Usage: GET /api/debug-brevo  (no body needed)
export default async function handler(req, res) {
  const BREVO_API_KEY  = process.env.BREVO_API_KEY;
  const SENDER_EMAIL   = process.env.BREVO_SENDER_EMAIL;
  const SENDER_NAME    = process.env.BREVO_SENDER_NAME || "WC2026 Predictor";

  const config = {
    BREVO_API_KEY:    BREVO_API_KEY  ? `set (${BREVO_API_KEY.slice(0, 8)}...)` : "MISSING",
    BREVO_SENDER_EMAIL: SENDER_EMAIL ?? "MISSING",
    BREVO_SENDER_NAME:  SENDER_NAME,
  };

  if (!BREVO_API_KEY || !SENDER_EMAIL) {
    return res.status(200).json({ ok: false, config, error: "Missing env vars (see config above)" });
  }

  // Ping Brevo: try to send to the sender itself (free, no real delivery needed)
  let brevoStatus, brevoBody;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: SENDER_EMAIL }],
        subject: "Brevo diagnostic ping — WC2026",
        htmlContent: "<p>Diagnostic ping from the debug-brevo endpoint. Ignore this email.</p>",
      }),
    });
    brevoStatus = r.status;
    brevoBody   = await r.text();
  } catch (e) {
    return res.status(200).json({ ok: false, config, fetchError: e.message });
  }

  let parsed;
  try { parsed = JSON.parse(brevoBody); } catch { parsed = brevoBody; }

  return res.status(200).json({
    ok:          brevoStatus >= 200 && brevoStatus < 300,
    brevoStatus,
    brevoResponse: parsed,
    config,
  });
}
