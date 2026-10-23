CREATE INDEX cards_review_queue ON cards(user_id, CASE WHEN state=3 THEN 0 ELSE 1 END, due, word_id) WHERE reps>0;
CREATE INDEX cards_new_queue ON cards(user_id,word_id) WHERE reps=0;
CREATE INDEX reviews_recent ON review_logs(user_id,at DESC);
