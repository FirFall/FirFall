CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT,
  banned_at TEXT,
  banned_by TEXT,
  last_ip TEXT,
  banner_key TEXT,
  avatar_key TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS videos(
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  file_id TEXT,
  thumb_key TEXT,
  thumb_id TEXT,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'clean',
  flag_reason TEXT,
  scan TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  duration REAL NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TEXT NOT NULL,
  -- 'video' for ordinary uploads, 'ember' for vertical clips recorded in the
  -- mobile app. Embers are still videos; they are just filtered by shape and
  -- shown in a vertical feed. Adding the column here means a fresh D1 comes up
  -- with it already there.
  kind TEXT NOT NULL DEFAULT 'video'
);
CREATE INDEX IF NOT EXISTS idx_videos_kind ON videos(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner);
CREATE INDEX IF NOT EXISTS idx_videos_recent ON videos(status, created_at DESC);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  user TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'clean',
  -- A reply points at the comment it answers. One level only: the worker stores
  -- the GRANDparent, so a reply to a reply becomes a sibling and threads stay
  -- readable instead of indenting forever.
  parent_id INTEGER,
  -- "@someone" this comment answers, so the UI can say who it is aimed at
  -- without a second lookup.
  reply_to TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
-- Hearts on a comment are the person who uploaded the video saying "yes, this
-- one". Only they can give one, and that is enforced in the worker.
CREATE TABLE IF NOT EXISTS comment_likes(
  comment_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  PRIMARY KEY (comment_id, username)
);
CREATE INDEX IF NOT EXISTS idx_clikes_comment ON comment_likes(comment_id);
-- The uploader's heart on a comment, kept apart from the like anyone can give.
CREATE TABLE IF NOT EXISTS comment_hearts(
  comment_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  PRIMARY KEY (comment_id, username)
);
CREATE INDEX IF NOT EXISTS idx_chears_comment ON comment_hearts(comment_id);
CREATE TABLE IF NOT EXISTS video_likes(
  video_id TEXT NOT NULL,
  username TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'like',
  created_at TEXT NOT NULL,
  PRIMARY KEY (video_id, username)
);
CREATE TABLE IF NOT EXISTS subscriptions(
  channel TEXT NOT NULL,
  subscriber TEXT NOT NULL,
  notify TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL,
  PRIMARY KEY (channel, subscriber)
);
CREATE INDEX IF NOT EXISTS idx_subs_subscriber ON subscriptions(subscriber);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  video_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(username, id DESC);
CREATE TABLE IF NOT EXISTS uploads(
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  storage_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'public',
  b2_file_id TEXT NOT NULL,
  b2_upload_url TEXT NOT NULL,
  b2_part_token TEXT NOT NULL,
  part_num INTEGER NOT NULL DEFAULT 0,
  parts_json TEXT NOT NULL DEFAULT '[]',
  uploaded INTEGER NOT NULL DEFAULT 0,
  scan TEXT NOT NULL DEFAULT 'skipped',
  created_at TEXT NOT NULL,
  -- Carried from /api/uploads/start into videos.kind on completion.
  kind TEXT NOT NULL DEFAULT 'video'
);
-- Stores HMAC-SHA256 fingerprints of IP addresses, never the addresses themselves.
-- Both the write (on ban) and the read (on every request) hash with IP_HASH_KEY,
-- so banning stays a simple equality lookup without the plaintext ever existing.
CREATE TABLE IF NOT EXISTS poison_bans(
  ip TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
-- Appeals submitted from the ban screen. FirFall has no Discord yet, so this is
-- where appeals actually land; a moderator reads and answers them in the panel.
-- One open appeal per account keeps the inbox usable.
CREATE TABLE IF NOT EXISTS appeals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status, created_at DESC);
-- A banned account is refused a session token, so it cannot sign in to appeal.
-- Login mints one of these instead: it authorises posting an appeal and nothing
-- else, is scoped to a single account, and is discarded once the appeal is filed.
CREATE TABLE IF NOT EXISTS ban_tokens(
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- User reports against a comment or a video. target_kind + target_id is a
-- polymorphic pointer rather than two nullable columns so one queue and one
-- resolution path cover both. UNIQUE on reporter is deliberately per-target,
-- not global: someone should be able to flag two different videos.
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reporter TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'other',
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_once ON reports(target_kind, target_id, reporter);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
-- Per-viewer, per-day watch stats, which is what FirFall Studio's analytics
-- and retention read. One row per (video, day, viewer) so re-watching the same
-- clip on the same day updates a row instead of inflating the count, and so
-- "how far people got" can be averaged without storing every play event.
-- viewer is a client-generated random id, NOT an account: retention has to
-- work for signed-out visitors and must not turn into a tracking record.
CREATE TABLE IF NOT EXISTS video_stats(
  video_id TEXT NOT NULL,
  day TEXT NOT NULL,
  viewer TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  watched_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, day, viewer)
);
CREATE INDEX IF NOT EXISTS idx_stats_day ON video_stats(day);
-- A member asked for their account to be deleted. A moderator reviews it and
-- confirms; if nobody gets to it, the scheduled sweep carries it out after
-- three days anyway. status is pending until it is either confirmed, cancelled
-- by the member, or done by the sweep ('reviewed_by' is then 'auto').
CREATE TABLE IF NOT EXISTS deletion_requests(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_delreq_status ON deletion_requests(status, requested_at);
