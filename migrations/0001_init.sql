-- The whole D1 schema (docs/architecture.md). Times are Unix epoch
-- milliseconds (UTC).
--
-- Privacy: raw e-mail addresses and IPs are never stored. `email_hash` is
-- sha256(salt + ":email:" + lower(trim(email))); `ip_hash` is sha256(salt + ip)
-- where ip is the IPv4 address or the IPv6 /64. Both are used only for rate
-- limiting and spotting repeat abuse in /admin/ (see src/lib/server/http.ts).

-- Optional GitHub login (docs/design.md 「访客互动」):
--   * users: the public GitHub profile of everyone who logged in. No e-mail,
--     no access token: the OAuth token is used once to read /user and dropped;
--   * sessions: one row per login. `id` is sha256 of the 256-bit session token
--     in the `sid` cookie, so a database leak does not hand out live sessions
--     (see src/lib/server/auth.ts);
--   * comments.user_id / stickers.user_id: set when a logged-in visitor posts,
--     so their pending items and their stickers follow them across devices.
-- Anonymous comments and stickers keep user_id NULL. Everything is still
-- pre-moderated.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT NOT NULL,
  html_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Refreshed at most once a day (sliding expiry), not on every request.
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Visitor comments: normal ones and inline (highlight) ones.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  -- Set when the visitor pressed 回复 on another comment.
  parent_id TEXT REFERENCES comments (id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'inline')),
  -- Inline comments only: the highlighted text and ~12 characters before it.
  anchor_exact TEXT,
  anchor_prefix TEXT,
  name TEXT NOT NULL,
  email_hash TEXT,
  site TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  owner_reply TEXT,
  owner_reply_at INTEGER,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  ip_hash TEXT NOT NULL,
  ua TEXT,
  user_id TEXT REFERENCES users (id),
  CHECK (
    (kind = 'comment' AND anchor_exact IS NULL)
    OR (kind = 'inline' AND anchor_exact IS NOT NULL)
  )
);

-- Public list per note.
CREATE INDEX comments_slug_status ON comments (slug, status, created_at);
-- Admin queue.
CREATE INDEX comments_status ON comments (status, created_at);
-- Rate limiting, per IP and per account.
CREATE INDEX comments_ip ON comments (ip_hash, created_at);
CREATE INDEX comments_user ON comments (user_id, created_at);

-- Visitor stickers. Moving a placed sticker (docs/design.md 「访客互动」):
--   * the uploader moves their own sticker with a secret edit token that the
--     POST /api/stickers response returned once; only its salted hash is kept
--     (sha256(salt + ":edit:" + token), see src/lib/server/edit-token.ts);
--   * the owner moves any visitor sticker from the canvas (整理贴纸);
--   * every move is logged in moderation_log with decision 'move'.
CREATE TABLE stickers (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/webp', 'image/gif', 'image/jpeg')),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  -- Canvas world coordinates of the sticker centre (origin = intro card centre).
  x REAL NOT NULL,
  y REAL NOT NULL,
  rotation REAL NOT NULL DEFAULT 0,
  scale REAL NOT NULL DEFAULT 1,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  ip_hash TEXT NOT NULL,
  edit_token_hash TEXT,
  updated_at INTEGER,
  user_id TEXT REFERENCES users (id)
);

CREATE INDEX stickers_status ON stickers (status, created_at);
CREATE INDEX stickers_ip ON stickers (ip_hash, created_at);
CREATE INDEX stickers_user ON stickers (user_id, created_at);

-- Every decision, automatic or manual, and every sticker move. ip_hash is
-- only set for visitor moves (they are rate-limited by counting rows that
-- already exist, no extra writes); decisions leave it NULL.
CREATE TABLE moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL CHECK (item_type IN ('comment', 'sticker')),
  item_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'hold', 'reply', 'move')),
  -- 'moderator:manual', 'moderator:ai', 'admin:<email>' or 'visitor:owner'.
  actor TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  ip_hash TEXT
);

CREATE INDEX moderation_log_item ON moderation_log (item_type, item_id);
-- Rate limit for visitor moves.
CREATE INDEX moderation_log_moves ON moderation_log (decision, ip_hash, created_at);

-- Built-in stickers the owner threw into the trash. The built-in stickers
-- are part of the code (src/lib/builtin-stickers.ts); a row here hides one
-- for every visitor until /admin/ restores it (the row is deleted then).
-- `key` is the sticker's data-sticker-key, e.g. "outer:place-tram".
-- `hidden_by` is 'admin:<email>' (Cloudflare Access) or
-- 'owner:github:<login>' (the owner's GitHub session). Not logged in
-- moderation_log: its item_type only allows comments and stickers, and this
-- row already says who hid it and when.
CREATE TABLE hidden_builtins (
  key TEXT PRIMARY KEY,
  hidden_at INTEGER NOT NULL,
  hidden_by TEXT NOT NULL
);
