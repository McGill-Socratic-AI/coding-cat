-- AI Analysis feature (v1)
-- Adds the analyze_calls log/rate-limit table and the AIAnalysis feature flag row.
--
-- TODO (post-v1): analyze_calls grows unboundedly. Add a scheduled cleanup
-- (e.g., supabase pg_cron) deleting rows older than 90 days once telemetry
-- shows real growth. Free-tier database storage (500 MB) is the limiting
-- factor; each row is ~1-10 KB depending on code length.

CREATE TABLE analyze_calls (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_name  TEXT NOT NULL,
  code          TEXT NOT NULL,
  response      TEXT NOT NULL,
  model         TEXT NOT NULL,
  latency_ms    INT  NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX analyze_calls_user_recent_idx
  ON analyze_calls(user_id, created_at DESC);

CREATE INDEX analyze_calls_user_problem_idx
  ON analyze_calls(user_id, problem_name);

ALTER TABLE analyze_calls ENABLE ROW LEVEL SECURITY;

-- Users may read their own rows (e.g. for any future "analysis history" UI).
CREATE POLICY analyze_calls_self_read ON analyze_calls
  FOR SELECT USING (auth.uid() = user_id);

-- INTENTIONALLY no INSERT policy. The Edge Function uses the service-role
-- client (SUPABASE_SERVICE_ROLE_KEY) for log inserts; this prevents users
-- from manufacturing rows under arbitrary user_ids via RLS bypass.

-- Add the feature flag row, default OFF so the feature is dark until flipped.
INSERT INTO activated(topic, activated)
VALUES ('AIAnalysis', false)
ON CONFLICT DO NOTHING;
