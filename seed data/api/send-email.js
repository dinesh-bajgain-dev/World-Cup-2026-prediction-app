// api/send-email.js (Vercel Serverless Function)
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html } = req.body;
  const BREVO_API_KEY = process.env.BREVO_API_KEY; // ✅ Secure: stored in Vercel env vars

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          name: 'World Cup App',
          email: 'noreply@yourdomain.com'
        },
        to: [{ email: to }],
        subject: subject,
        htmlContent: html
      })
    });

    if (!response.ok) {
      throw new Error(`Brevo API error: ${response.status}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}