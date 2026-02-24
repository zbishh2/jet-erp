-- Migration: Multi-select role system
-- Allow multiple role rows per user/org/module (e.g. VIEWER + FINANCE)
-- Existing ESTIMATOR users keep ESTIMATOR and also get VIEWER + FINANCE

-- Step 1: Drop the old unique index (userId, orgId, moduleId) — one row per user
DROP INDEX IF EXISTS user_org_module_idx;

-- Step 2: Create new unique index on (userId, orgId, moduleId, role)
CREATE UNIQUE INDEX user_org_module_role_idx ON user_organization_module (user_id, organization_id, module_id, role);

-- Step 3: For existing ESTIMATOR users, insert a VIEWER row
INSERT INTO user_organization_module (id, user_id, organization_id, module_id, role, is_active, granted_at, granted_by_user_id, created_at, updated_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  user_id,
  organization_id,
  module_id,
  'VIEWER',
  is_active,
  granted_at,
  granted_by_user_id,
  created_at,
  updated_at
FROM user_organization_module
WHERE role = 'ESTIMATOR'
  AND module_id IN (SELECT id FROM module WHERE code = 'erp');

-- Step 4: For existing ESTIMATOR users, insert a FINANCE row
INSERT INTO user_organization_module (id, user_id, organization_id, module_id, role, is_active, granted_at, granted_by_user_id, created_at, updated_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  user_id,
  organization_id,
  module_id,
  'FINANCE',
  is_active,
  granted_at,
  granted_by_user_id,
  created_at,
  updated_at
FROM user_organization_module
WHERE role = 'ESTIMATOR'
  AND module_id IN (SELECT id FROM module WHERE code = 'erp');
