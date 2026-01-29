const express = require("express");
const Database = require("better-sqlite3");
const { v4: uuid } = require("uuid");

const app = express();
app.use(express.json());

const db = new Database("pastes.db");

db.prepare(`
  CREATE TABLE IF NOT EXISTS pastes (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ttl_seconds INTEGER,
    max_views INTEGER,
    views INTEGER NOT NULL
  )
`).run();

function now(req) {
  if (process.env.TEST_MODE === "1" && req.headers["x-test-now-ms"]) {
    return parseInt(req.headers["x-test-now-ms"]);
  }
  return Date.now();
}

app.get("/api/healthz", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.post("/api/pastes", (req, res) => {
  const { content, ttl_seconds, max_views } = req.body;

  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "Invalid content" });
  }
  if (ttl_seconds && ttl_seconds < 1) {
    return res.status(400).json({ error: "Invalid ttl_seconds" });
  }
  if (max_views && max_views < 1) {
    return res.status(400).json({ error: "Invalid max_views" });
  }

  const id = uuid();

  db.prepare(`
    INSERT INTO pastes VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, content, Date.now(), ttl_seconds || null, max_views || null, 0);

  res.json({
    id,
    url: `${req.protocol}://${req.get("host")}/p/${id}`
  });
});

app.get("/api/pastes/:id", (req, res) => {
  const paste = db.prepare(
    "SELECT * FROM pastes WHERE id = ?"
  ).get(req.params.id);

  if (!paste) return res.status(404).json({ error: "Not found" });

  const time = now(req);

  if (paste.ttl_seconds) {
    const exp = paste.created_at + paste.ttl_seconds * 1000;
    if (time >= exp) {
      db.prepare("DELETE FROM pastes WHERE id=?").run(paste.id);
      return res.status(404).json({ error: "Expired" });
    }
  }

  if (paste.max_views && paste.views >= paste.max_views) {
    return res.status(404).json({ error: "View limit exceeded" });
  }

  db.prepare("UPDATE pastes SET views = views + 1 WHERE id=?").run(paste.id);

  res.json({
    content: paste.content,
    remaining_views: paste.max_views
      ? paste.max_views - paste.views - 1
      : null,
    expires_at: paste.ttl_seconds
      ? new Date(paste.created_at + paste.ttl_seconds * 1000).toISOString()
      : null
  });
});

app.get("/p/:id", (req, res) => {
  const paste = db.prepare(
    "SELECT * FROM pastes WHERE id=?"
  ).get(req.params.id);

  if (!paste) return res.status(404).send("Paste not found");

  res.send(`
    <html>
      <body>
        <pre>${paste.content.replace(/</g, "&lt;")}</pre>
      </body>
    </html>
  `);
});

app.listen(3000, () => {
  console.log("Running on http://localhost:3000");
});
