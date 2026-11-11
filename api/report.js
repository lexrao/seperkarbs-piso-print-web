// Vercel serverless function: sends a refund request (with the proof photo) to the owner on Telegram.
// Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID in Vercel > Project > Settings > Environment Variables.
const REASONS = ["Wrong or error print", "Paper jam", "Other"];
const hits = new Map(); // best-effort limit per visitor; resets when the function restarts

const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Send a POST request" });

  const token = process.env.TELEGRAM_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return res.status(500).json({ error: "Owner alerts are not set up yet" });

  const b = req.body && typeof req.body === "object" ? req.body : {};
  if (b.website) return res.status(200).json({ ok: true }); // honeypot field: bots fill it in

  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const recent = (hits.get(ip) || []).filter((t) => Date.now() - t < 3600e3);
  if (recent.length >= 5) return res.status(429).json({ error: "Too many requests. Try again in an hour." });
  hits.set(ip, [...recent, Date.now()]);

  const reason = clean(b.reason, 40);
  const note = clean(b.note, 500);
  const name = clean(b.gcashName, 60);
  const number = String(b.gcashNumber || "").replace(/[\s-]/g, "");
  const amount = Number(b.amount);

  if (!REASONS.includes(reason)) return res.status(400).json({ error: "Choose what went wrong" });
  if (reason === "Other" && !note) return res.status(400).json({ error: "Describe the problem in the message box" });
  if (!(amount >= 1 && amount <= 1000)) return res.status(400).json({ error: "Enter the amount you paid in pesos" });
  if (!name || !/^(09|\+639)\d{9}$/.test(number))
    return res.status(400).json({ error: "Enter the GCash name and a valid number (09XXXXXXXXX)" });

  const photo = String(b.photo || "");
  const comma = photo.indexOf(",");
  const head = /^data:image\/(jpeg|png|webp);base64$/.exec(photo.slice(0, comma));
  if (!head) return res.status(400).json({ error: "Attach a photo of the problem (JPG or PNG)" });
  const bytes = Buffer.from(photo.slice(comma + 1), "base64");
  if (bytes.length > 3e6) return res.status(413).json({ error: "That photo is too large" });

  const text = [
    "SEPERKARBS PISO PRINT refund request",
    "",
    `Reason: ${reason}`,
    `Customer message: ${note || "-"}`,
    `Amount paid: PHP ${Math.round(amount)}`,
    `GCash name: ${name}`,
    `GCash number: ${number}`,
    "Proof photo attached.",
  ].join("\n");

  const form = new FormData();
  form.append("chat_id", chat);
  form.append("caption", text.slice(0, 1000));
  form.append("photo", new Blob([bytes], { type: `image/${head[1]}` }), `proof.${head[1] === "jpeg" ? "jpg" : head[1]}`);

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
    if (!r.ok) return res.status(502).json({ error: "Could not reach the owner. Try again later." });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the owner. Try again later." });
  }
  return res.status(200).json({ ok: true });
};
