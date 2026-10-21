ALTER TABLE review_logs ADD COLUMN answer_correct INTEGER CHECK(answer_correct IN (0,1) OR answer_correct IS NULL);
CREATE TABLE ai_usage(day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
