// api/send-email.js
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function sendWithRetry(payload, apiKey, attempt = 1) {
  const start = Date.now();
  let lastError;

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      const response = await fetch(BREVO_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(payload),
      });

      const elapsed = Date.now() - start;

      if (response.ok) {
        const result = await response.json();
        console.log(
          `[email] ✅ Sent to=${payload.to[0]?.email} subject="${payload.subject}" attempt=${i} elapsed=${elapsed}ms messageId=${result.messageId || "n/a"}`,
        );
        return { ok: true, result };
      }

      const errorBody = await response.text();
      lastError = `Brevo API Error (${response.status}): ${errorBody}`;
      console.warn(
        `[email] ⚠️ Attempt ${i}/${MAX_RETRIES} failed to=${payload.to[0]?.email} status=${response.status} body=${errorBody}`,
      );

      // 4xx errors are not retryable (bad request, auth failure, etc.)
      if (response.status >= 400 && response.status < 500) {
        break;
      }
    } catch (err) {
      lastError = err.message;
      console.warn(
        `[email] ⚠️ Attempt ${i}/${MAX_RETRIES} network error to=${payload.to[0]?.email} error=${err.message}`,
      );
    }

    if (i < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * i));
    }
  }

  console.error(
    `[email] ❌ All ${MAX_RETRIES} attempts failed to=${payload.to[0]?.email} subject="${payload.subject}" lastError=${lastError}`,
  );
  return { ok: false, error: lastError };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, subject, html } = req.body;

  if (!to || !subject) {
    return res.status(400).json({ error: "Missing required fields: to, subject" });
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL;   // must be set — no fallback
  const SENDER_NAME   = process.env.BREVO_SENDER_NAME || "World Cup 2026 Predictor";

  if (!BREVO_API_KEY) {
    console.error("[email] ❌ BREVO_API_KEY not set");
    return res.status(500).json({ error: "Email service not configured (missing API key)" });
  }
  if (!SENDER_EMAIL) {
    console.error("[email] ❌ BREVO_SENDER_EMAIL not set");
    return res.status(500).json({ error: "Email service not configured (missing sender address)" });
  }

  console.log(
    `[email] 📨 Sending email to=${to} subject="${subject}" sender=${SENDER_EMAIL}`,
  );

  const payload = {
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    to: [{ email: to }],
    subject,
    htmlContent: html || "<p>Email sent from World Cup 2026 Predictor</p>",
  };

  const { ok, result, error } = await sendWithRetry(payload, BREVO_API_KEY);

  if (ok) {
    return res.status(200).json({ success: true, messageId: result?.messageId });
  }

  return res.status(500).json({ success: false, error });
}
