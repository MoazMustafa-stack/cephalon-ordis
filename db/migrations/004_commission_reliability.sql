ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0);

CREATE INDEX IF NOT EXISTS runs_claim_lease_idx
  ON runs (state, lease_expires_at)
  WHERE state = 'claimed';

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  kind text NOT NULL CHECK (kind IN ('workpiece', 'execution')),
  label text NOT NULL,
  media_type text NOT NULL,
  body text NOT NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifacts_run_created_idx ON artifacts (run_id, created_at DESC, id DESC);
