import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createClient } from "@supabase/supabase-js";

// ─── Shared helpers (mirrors api/send-otp.js and api/verify-otp.js) ──────────

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ─── Vite config ──────────────────────────────────────────────────────────────

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),

      // Dev-only: handle /api/send-otp and /api/verify-otp without a separate server
      {
        name: "dev-api-routes",
        configureServer(server) {
          const supabase = createClient(
            env.VITE_SUPABASE_URL,
            env.VITE_SUPABASE_ANON_KEY,
          );

          // POST /api/send-otp
          server.middlewares.use("/api/send-otp", async (req, res, next) => {
            if (req.method !== "POST") return next();

            const { email, username } = await readBody(req);
            if (!email) return json(res, 400, { success: false, error: "email required" });

            const code = generateOTP();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

            // Clear old codes for this email
            await supabase.from("email_verifications").delete().eq("email", email).eq("used", false);

            const { error: dbError } = await supabase
              .from("email_verifications")
              .insert({ email, code, expires_at: expiresAt });

            if (dbError) {
              console.error("[dev-api/send-otp] DB error:", dbError.message);
              return json(res, 500, { success: false, error: dbError.message });
            }

            // In dev: print OTP to terminal instead of sending email
            console.log("\n" + "═".repeat(50));
            console.log(`  📧 DEV OTP for: ${email}`);
            console.log(`  🔑 Code:        ${code}`);
            console.log(`  ⏰ Expires:     10 minutes`);
            console.log("═".repeat(50) + "\n");

            return json(res, 200, { success: true, dev: true });
          });

          // POST /api/verify-otp
          server.middlewares.use("/api/verify-otp", async (req, res, next) => {
            if (req.method !== "POST") return next();

            const { email, code } = await readBody(req);
            if (!email || !code) {
              return json(res, 400, { success: false, error: "email and code required" });
            }

            const { data, error } = await supabase
              .from("email_verifications")
              .select("id, expires_at, used")
              .eq("email", email)
              .eq("code", code.trim())
              .eq("used", false)
              .maybeSingle();

            if (error) return json(res, 500, { success: false, error: error.message });

            if (!data) {
              return json(res, 200, { success: false, error: "Invalid code — check the code and try again" });
            }

            if (new Date(data.expires_at) < new Date()) {
              return json(res, 200, { success: false, error: "Code has expired — request a new one" });
            }

            await supabase.from("email_verifications").update({ used: true }).eq("id", data.id);

            console.log(`[dev-api/verify-otp] ✅ Verified ${email}`);
            return json(res, 200, { success: true });
          });
        },
      },
    ],

    server: { port: 5173, open: true },
  };
});
