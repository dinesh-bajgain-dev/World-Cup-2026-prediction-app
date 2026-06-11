// api/send-email.js
export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { to, subject, html } = req.body;

  // Validate input
  if (!to || !subject) {
    return res
      .status(400)
      .json({ error: "Missing required fields: to, subject" });
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;

  if (!BREVO_API_KEY) {
    return res.status(500).json({ error: "Brevo API Key not configured" });
  }

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          name: "World Cup Predictor",
          email: "noreply@yourdomain.com", // ⚠️ CHANGE THIS to your verified Brevo sender
        },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html || "<h1>Email Sent</h1>",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Brevo API Error (${response.status}): ${errorText}`);
    }

    return res
      .status(200)
      .json({ success: true, message: "Email sent successfully" });
  } catch (error) {
    console.error("Email sending failed:", error);
    return res.status(500).json({ error: error.message });
  }
}
