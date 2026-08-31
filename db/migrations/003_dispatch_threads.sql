ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_state_check;
ALTER TABLE threads ADD CONSTRAINT threads_state_check
  CHECK (state IN ('planned', 'dispatched'));
