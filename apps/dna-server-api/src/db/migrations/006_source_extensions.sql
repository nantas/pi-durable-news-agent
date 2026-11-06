CREATE TABLE sources_new (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('rss', 'atom', 'hn_front', 'hn_search', 'github_releases', 'web_page', 'youtube_channel', 'github_topic')),
  name TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  weight REAL NOT NULL DEFAULT 1.0,
  interval_min INTEGER NOT NULL DEFAULT 15,
  enabled INTEGER NOT NULL DEFAULT 1,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_error TEXT,
  last_fetched_at TEXT,
  etag TEXT,
  last_modified TEXT,
  origin TEXT NOT NULL DEFAULT 'config' CHECK (origin IN ('config', 'user', 'agent', 'upvote')),
  reason TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (kind, url, query)
);

INSERT INTO sources_new SELECT * FROM sources;
DROP TABLE sources;
ALTER TABLE sources_new RENAME TO sources;
ALTER TABLE source_cache ADD COLUMN metadata_json TEXT;
