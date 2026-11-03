BEGIN;

CREATE TABLE IF NOT EXISTS activation_attempts (
  attempt_id UUID PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  device_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  outcome TEXT NOT NULL CHECK (outcome IN ('in_progress', 'success', 'failed', 'interrupted')),
  duration_ms BIGINT NOT NULL CHECK (duration_ms >= 0),
  diagnostics JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS activation_attempts_device_started_idx
  ON activation_attempts (tenant_id, device_id, started_at DESC, attempt_id DESC);
CREATE INDEX IF NOT EXISTS activation_attempts_expiry_idx ON activation_attempts (expires_at);

COMMIT;