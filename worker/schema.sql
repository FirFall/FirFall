CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
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
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner);
CREATE INDEX IF NOT EXISTS idx_videos_recent ON videos(status, created_at DESC);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  user TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'clean',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
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
  created_at TEXT NOT NULL
);
