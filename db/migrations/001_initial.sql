CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE run_state AS ENUM (
  'queued', 'waiting_for_allowance', 'claimed', 'running', 'awaiting_approval',
  'succeeded', 'failed', 'cancelled'
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  repository_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nodes (
  id uuid PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('windows', 'arch')),
  capabilities jsonb NOT NULL DEFAULT '[]',
  allowance text NOT NULL CHECK (allowance IN ('available', 'limited', 'exhausted', 'unknown')),
  active_runs integer NOT NULL DEFAULT 0 CHECK (active_runs >= 0),
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  command_id uuid,
  state run_state NOT NULL DEFAULT 'queued',
  assigned_node_id uuid REFERENCES nodes(id),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runs_claimable_idx ON runs (state, created_at)
  WHERE state IN ('queued', 'waiting_for_allowance');

CREATE TABLE run_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_events_run_idx ON run_events (run_id, id);

CREATE FUNCTION prevent_run_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'run_events is append-only';
END $$;
CREATE TRIGGER run_events_append_only
  BEFORE UPDATE OR DELETE ON run_events
  FOR EACH ROW EXECUTE FUNCTION prevent_run_event_mutation();

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id),
  scope text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'consumed', 'expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (id, run_id)
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL,
  title text NOT NULL,
  body jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idea_graphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  graph jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE portfolio_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_on date NOT NULL,
  account text NOT NULL,
  asset text NOT NULL,
  side text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric,
  currency char(3) NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE ROLE ordis_portfolio_reader NOLOGIN;
GRANT SELECT ON portfolio_transactions TO ordis_portfolio_reader;
