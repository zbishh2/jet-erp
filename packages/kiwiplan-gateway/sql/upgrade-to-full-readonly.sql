-- ============================================================================
-- KIWIPLAN GATEWAY - UPGRADE TO FULL READ-ONLY ACCESS
-- ============================================================================
--
-- PURPOSE: Upgrade leango_gateway_ro from table-specific SELECT to full
--          database read access for schema exploration and development.
--
-- WHAT THE USER CAN DO AFTER:
--   - SELECT from any table in esp
--   - Query sys.tables, INFORMATION_SCHEMA.COLUMNS, etc.
--   - Browse the full Kiwiplan schema
--
-- WHAT THE USER STILL CANNOT DO:
--   - INSERT, UPDATE, DELETE on any table
--   - CREATE, ALTER, or DROP anything
--   - EXECUTE stored procedures or functions
--
-- NOTE ON ATOMICITY:
--   SQL Server GO separates batches so this cannot be a single transaction.
--   Steps are ordered defensively: DB-level denies are applied FIRST, before
--   any table-level permissions are relaxed. If the script fails partway,
--   permissions will be equal or MORE restrictive than before, never less.
--
-- NOTE ON DATA EXPOSURE:
--   db_datareader grants SELECT on all current and future tables/views in esp.
--   This is intentional for schema exploration during development. The Kiwiplan
--   database is on a private network (192.168.1.12) accessible only via VPN.
--   All access is further gated by the gateway's service token authentication.
--
-- BEFORE RUNNING:
--   1. Connect to SQL Server as an administrator
--   2. Run against the esp database
--
-- ============================================================================

USE esp;
GO

-- ============================================================================
-- Step 1: Apply DB-level write denies FIRST (before relaxing anything)
-- ============================================================================
-- This ensures there is never a moment where writes are possible,
-- even if table-level denies are removed in a later step.

DENY INSERT TO leango_gateway_ro;
DENY UPDATE TO leango_gateway_ro;
DENY DELETE TO leango_gateway_ro;
DENY CREATE TABLE TO leango_gateway_ro;
DENY ALTER ANY SCHEMA TO leango_gateway_ro;
DENY EXECUTE TO leango_gateway_ro;

PRINT 'Step 1: Database-level DENY for all write operations applied';
GO

-- ============================================================================
-- Step 2: Remove old per-table DENYs (now redundant — DB-level covers them)
-- ============================================================================
-- db_datareader + per-table DENY = DENY wins (SQL Server precedence).
-- We must remove these so db_datareader's SELECT actually works on these tables.
-- Write protection is already guaranteed by DB-level denies from Step 1.

REVOKE INSERT, UPDATE, DELETE ON ebxQuote FROM leango_gateway_ro;
REVOKE INSERT, UPDATE, DELETE ON ebxProductDesign FROM leango_gateway_ro;
REVOKE INSERT, UPDATE, DELETE ON orgCompany FROM leango_gateway_ro;
REVOKE INSERT, UPDATE, DELETE ON cstCostRule FROM leango_gateway_ro;
REVOKE INSERT, UPDATE, DELETE ON cstCostAccount FROM leango_gateway_ro;
REVOKE INSERT, UPDATE, DELETE ON cstCostEstimate FROM leango_gateway_ro;

PRINT 'Step 2: Removed old per-table DENY statements (redundant now)';
GO

-- Also revoke the old per-table GRANTs (db_datareader replaces them)
REVOKE SELECT ON ebxQuote FROM leango_gateway_ro;
REVOKE SELECT ON ebxProductDesign FROM leango_gateway_ro;
REVOKE SELECT ON orgCompany FROM leango_gateway_ro;
REVOKE SELECT ON cstCostRule FROM leango_gateway_ro;
REVOKE SELECT ON cstCostAccount FROM leango_gateway_ro;
REVOKE SELECT ON cstCostEstimate FROM leango_gateway_ro;

PRINT 'Step 2b: Removed old per-table GRANT SELECT statements';
GO

-- ============================================================================
-- Step 3: Add db_datareader role (SELECT on all tables)
-- ============================================================================

IF NOT EXISTS (
    SELECT 1 FROM sys.database_role_members drm
    JOIN sys.database_principals dp ON drm.member_principal_id = dp.principal_id
    JOIN sys.database_principals r ON drm.role_principal_id = r.principal_id
    WHERE dp.name = 'leango_gateway_ro' AND r.name = 'db_datareader'
)
BEGIN
    ALTER ROLE db_datareader ADD MEMBER leango_gateway_ro;
    PRINT 'Step 3: Added to db_datareader role';
END
ELSE
BEGIN
    PRINT 'Step 3: Already a member of db_datareader (no change)';
END
GO

-- ============================================================================
-- Step 4: Grant schema exploration permissions
-- ============================================================================

-- Remove any existing DENY on VIEW DEFINITION first
IF EXISTS (
    SELECT 1 FROM sys.database_permissions p
    JOIN sys.database_principals dp ON p.grantee_principal_id = dp.principal_id
    WHERE dp.name = 'leango_gateway_ro'
      AND p.permission_name = 'VIEW DEFINITION'
      AND p.state_desc = 'DENY'
)
BEGIN
    REVOKE VIEW DEFINITION FROM leango_gateway_ro;
    PRINT 'Step 4: Revoked old DENY VIEW DEFINITION';
END
GO

GRANT VIEW DEFINITION TO leango_gateway_ro;

PRINT 'Step 4: Granted VIEW DEFINITION (schema exploration)';
GO

-- ============================================================================
-- VERIFICATION (runs as leango_gateway_ro to give accurate results)
-- ============================================================================

PRINT '';
PRINT '=== VERIFICATION (impersonating leango_gateway_ro) ===';
PRINT '';

EXECUTE AS USER = 'leango_gateway_ro';
GO

-- Test: Can SELECT key tables
PRINT 'SELECT access:';

BEGIN TRY SELECT TOP 1 1 FROM ebxQuote;           PRINT '  OK: ebxQuote'; END TRY BEGIN CATCH PRINT '  FAIL: ebxQuote - ' + ERROR_MESSAGE(); END CATCH;
BEGIN TRY SELECT TOP 1 1 FROM orgCompany;          PRINT '  OK: orgCompany'; END TRY BEGIN CATCH PRINT '  FAIL: orgCompany - ' + ERROR_MESSAGE(); END CATCH;
BEGIN TRY SELECT TOP 1 1 FROM cstCostRule;         PRINT '  OK: cstCostRule'; END TRY BEGIN CATCH PRINT '  FAIL: cstCostRule - ' + ERROR_MESSAGE(); END CATCH;
BEGIN TRY SELECT TOP 1 1 FROM ebxRoute;            PRINT '  OK: ebxRoute'; END TRY BEGIN CATCH PRINT '  FAIL: ebxRoute - ' + ERROR_MESSAGE(); END CATCH;
BEGIN TRY SELECT TOP 1 1 FROM ebxStyle;            PRINT '  OK: ebxStyle'; END TRY BEGIN CATCH PRINT '  FAIL: ebxStyle - ' + ERROR_MESSAGE(); END CATCH;
BEGIN TRY SELECT TOP 1 1 FROM ebxStandardBoard;    PRINT '  OK: ebxStandardBoard'; END TRY BEGIN CATCH PRINT '  FAIL: ebxStandardBoard - ' + ERROR_MESSAGE(); END CATCH;
BEGIN TRY SELECT TOP 1 1 FROM cstPlantRate;        PRINT '  OK: cstPlantRate'; END TRY BEGIN CATCH PRINT '  FAIL: cstPlantRate - ' + ERROR_MESSAGE(); END CATCH;
BEGIN TRY SELECT TOP 1 1 FROM cstStandardCostRate; PRINT '  OK: cstStandardCostRate'; END TRY BEGIN CATCH PRINT '  FAIL: cstStandardCostRate - ' + ERROR_MESSAGE(); END CATCH;
GO

-- Test: Schema exploration
PRINT '';
PRINT 'Schema exploration:';

BEGIN TRY
    DECLARE @tableCount INT;
    SELECT @tableCount = COUNT(*) FROM sys.tables;
    PRINT '  OK: sys.tables (' + CAST(@tableCount AS VARCHAR) + ' tables visible)';
END TRY
BEGIN CATCH
    PRINT '  FAIL: sys.tables - ' + ERROR_MESSAGE();
END CATCH;

BEGIN TRY
    DECLARE @colCount INT;
    SELECT @colCount = COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS;
    PRINT '  OK: INFORMATION_SCHEMA.COLUMNS (' + CAST(@colCount AS VARCHAR) + ' columns visible)';
END TRY
BEGIN CATCH
    PRINT '  FAIL: INFORMATION_SCHEMA.COLUMNS - ' + ERROR_MESSAGE();
END CATCH;
GO

-- Test: Write protection
PRINT '';
PRINT 'Write protection:';

SELECT
    HAS_PERMS_BY_NAME('ebxQuote', 'OBJECT', 'SELECT') AS [SELECT (expect 1)],
    HAS_PERMS_BY_NAME('ebxQuote', 'OBJECT', 'INSERT') AS [INSERT (expect 0)],
    HAS_PERMS_BY_NAME('ebxQuote', 'OBJECT', 'UPDATE') AS [UPDATE (expect 0)],
    HAS_PERMS_BY_NAME('ebxQuote', 'OBJECT', 'DELETE') AS [DELETE (expect 0)];
GO

-- Revert impersonation
REVERT;
GO

PRINT '';
PRINT '============================================================';
PRINT ' UPGRADE COMPLETE: leango_gateway_ro is now full read-only';
PRINT ' - Can SELECT any table in esp';
PRINT ' - Can browse schema (sys.tables, INFORMATION_SCHEMA)';
PRINT ' - Cannot INSERT, UPDATE, DELETE, CREATE, ALTER, or EXECUTE';
PRINT '============================================================';
GO
