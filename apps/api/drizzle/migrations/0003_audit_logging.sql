-- Audit log table for tracking business operations and admin actions
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user(id),
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_log_user_idx ON audit_log(user_id);
CREATE INDEX audit_log_action_idx ON audit_log(action);
CREATE INDEX audit_log_resource_idx ON audit_log(resource, resource_id);
CREATE INDEX audit_log_created_at_idx ON audit_log(created_at);

-- Auth event table for tracking authentication attempts (login, logout, failures)
CREATE TABLE auth_event (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  email TEXT,
  user_id TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX auth_event_email_idx ON auth_event(email);
CREATE INDEX auth_event_user_idx ON auth_event(user_id);
CREATE INDEX auth_event_type_idx ON auth_event(event_type);
CREATE INDEX auth_event_created_at_idx ON auth_event(created_at);
CREATE INDEX auth_event_ip_idx ON auth_event(ip_address);
