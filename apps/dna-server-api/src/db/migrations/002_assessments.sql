CREATE TABLE assessments (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  command TEXT NOT NULL,
  version INTEGER NOT NULL,
  material_hash TEXT NOT NULL,
  coverage_snapshot TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  jev_call_id INTEGER REFERENCES jev_calls(id),
  UNIQUE(item_id, command, version, material_hash, coverage_snapshot)
);
ALTER TABLE items ADD COLUMN current_assessment_id INTEGER REFERENCES assessments(id);
