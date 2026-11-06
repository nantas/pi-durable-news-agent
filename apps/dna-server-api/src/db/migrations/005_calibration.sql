ALTER TABLE feedback ADD COLUMN kind TEXT NOT NULL DEFAULT 'preference';
ALTER TABLE feedback ADD COLUMN assessment_id INTEGER REFERENCES assessments(id);
ALTER TABLE feedback ADD COLUMN conversation_id INTEGER;
ALTER TABLE feedback ADD COLUMN correction_json TEXT;
ALTER TABLE feedback ADD COLUMN tool_call_id TEXT;
CREATE UNIQUE INDEX feedback_tool_call ON feedback(tool_call_id) WHERE tool_call_id IS NOT NULL;
