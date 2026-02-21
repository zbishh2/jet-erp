-- Seed Jet Container organization
INSERT INTO organization (id, name, slug, domain, is_active, settings, created_at, updated_at)
VALUES ('14de08d0-44ec-4370-9b79-4ebf5790e198', 'Jet Container', 'jet-container', 'jetcontainer.com', 1, '{}', '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z');

-- Seed ERP module
INSERT INTO module (id, code, name, description, icon, is_active, sort_order, created_at, updated_at)
VALUES ('f3999f8f-707c-42a0-bee3-a03cd2afe6cc', 'erp', 'ERP', 'Corrugated industry ERP - estimating and Kiwiplan integration', 'Factory', 1, 0, '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z');

-- Link organization to module
INSERT INTO organization_module (id, organization_id, module_id, is_active, activated_at, settings, created_at, updated_at)
VALUES ('cf9cbb42-7d41-4513-be6b-beedd2ef3aaa', '14de08d0-44ec-4370-9b79-4ebf5790e198', 'f3999f8f-707c-42a0-bee3-a03cd2afe6cc', 1, '2026-02-20T00:00:00.000Z', '{}', '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z');

-- Seed user (password: JetContainer2024!)
INSERT INTO user (id, organization_id, email, display_name, password_hash, email_verified, is_active, is_platform_admin, created_at, updated_at)
VALUES ('3c08d86b-1b2c-468c-81b8-04beed82fbbc', '14de08d0-44ec-4370-9b79-4ebf5790e198', 'zackleango@jetcontainer.com', 'Zack', 'H3O2ZuMX6BIpWomd9uotXbi7rbvIs2rQh/f/EZdZPdsMesnjATBXqNVVFUPwCmxL', 1, 1, 1, '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z');

-- Link user to organization
INSERT INTO user_organization (id, user_id, organization_id, is_default, joined_at, is_active, created_at, updated_at)
VALUES ('acc57fc6-18d0-41d5-b4e6-9a9e2a3bd31e', '3c08d86b-1b2c-468c-81b8-04beed82fbbc', '14de08d0-44ec-4370-9b79-4ebf5790e198', 1, '2026-02-20T00:00:00.000Z', 1, '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z');

-- Link user to organization module with ADMIN role
INSERT INTO user_organization_module (id, user_id, organization_id, module_id, role, is_active, granted_at, created_at, updated_at)
VALUES ('bfe16d65-fa68-4547-bf00-50c0d2201d46', '3c08d86b-1b2c-468c-81b8-04beed82fbbc', '14de08d0-44ec-4370-9b79-4ebf5790e198', 'f3999f8f-707c-42a0-bee3-a03cd2afe6cc', 'ADMIN', 1, '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z');
