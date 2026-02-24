import express from "express";
import cors from "cors";
import webpush from "web-push";

const app = express();
app.use(express.json());
app.use(cors());

let VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || "").trim();
let VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();

let PUSH_ENABLED = false;

try {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      "mailto:nestor.manucci@gmail.com",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    PUSH_ENABLED = true;
    console.log("WebPush enabled");
  } else {
    console.log("WebPush disabled (missing VAPID keys)");
  }
} catch (e) {
  console.log("VAPID error, push disabled:", e.message);
}

app.get("/", (req, res) => {
  res.send("UIC Campana API running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/vapid-public-key", (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: "VAPID_PUBLIC_KEY missing" });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`UIC API running on :${PORT}`);
});
