ALTER TABLE daily_plans ADD COLUMN new_done INTEGER NOT NULL DEFAULT 0;
UPDATE daily_plans SET new_done=(SELECT count(*) FROM review_logs WHERE review_logs.day=daily_plans.day AND is_new=1);
