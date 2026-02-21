-- ============================================================================
-- KIWIPLAN GATEWAY - READ-ONLY SQL USER SETUP
-- ============================================================================
--
-- PURPOSE: Create a dedicated read-only user for the LeanGo gateway service
-- DATABASE: esp (Kiwiplan production)
-- SERVER: 192.168.1.12
--
-- BEFORE RUNNING:
-- 1. Connect to SQL Server as an administrator (sa or equivalent)
-- 2. Replace 'CHANGE_THIS_PASSWORD' with a strong password
-- 3. Review the table list to ensure it matches what the gateway needs
--
-- AFTER RUNNING:
-- 1. Update packages/kiwiplan-gateway/.env with new credentials
-- 2. Test connection with the new user
-- 3. Verify permissions with check-permissions.js
-- ============================================================================

-- Step 1: Create server login
-- This creates the login at the SQL Server instance level
USE master;
GO

-- Drop if exists (for re-running during setup)
IF EXISTS (SELECT * FROM sys.server_principals WHERE name = 'leango_gateway_ro')
BEGIN
    DROP LOGIN leango_gateway_ro;
END
GO

CREATE LOGIN leango_gateway_ro
    WITH PASSWORD = 'CHANGE_THIS_PASSWORD',
    DEFAULT_DATABASE = esp,
    CHECK_POLICY = ON;
GO

PRINT 'Server login created: leango_gateway_ro';
GO

-- Step 2: Create database user
-- This maps the login to a user in the esp database
USE esp;
GO

-- Drop if exists (for re-running during setup)
IF EXISTS (SELECT * FROM sys.database_principals WHERE name = 'leango_gateway_ro')
BEGIN
    DROP USER leango_gateway_ro;
END
GO

CREATE USER leango_gateway_ro FOR LOGIN leango_gateway_ro;
GO

PRINT 'Database user created in esp: leango_gateway_ro';
GO

-- Step 3: Grant full read access via db_datareader role
-- This grants SELECT on ALL tables (current and future)
ALTER ROLE db_datareader ADD MEMBER leango_gateway_ro;

PRINT 'Added to db_datareader role (SELECT on all tables)';
GO

-- Step 4: Grant schema exploration
GRANT VIEW DEFINITION TO leango_gateway_ro;

PRINT 'Granted VIEW DEFINITION (schema exploration)';
GO

-- Step 5: DENY all write operations at database level
-- db_datareader only grants SELECT, but these are defense-in-depth
DENY INSERT TO leango_gateway_ro;
DENY UPDATE TO leango_gateway_ro;
DENY DELETE TO leango_gateway_ro;
DENY CREATE TABLE TO leango_gateway_ro;
DENY ALTER ANY SCHEMA TO leango_gateway_ro;
DENY EXECUTE TO leango_gateway_ro;

PRINT 'Database-level DENY applied for all write operations';
GO

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show all permissions for the new user
PRINT '';
PRINT '=== VERIFICATION: Permissions for leango_gateway_ro ===';

SELECT
    dp.name AS [User],
    o.name AS [Table],
    p.permission_name AS [Permission],
    p.state_desc AS [State]
FROM sys.database_permissions p
JOIN sys.objects o ON p.major_id = o.object_id
JOIN sys.database_principals dp ON p.grantee_principal_id = dp.principal_id
WHERE dp.name = 'leango_gateway_ro'
    AND o.type = 'U'
ORDER BY
    p.state_desc DESC,  -- DENY first, then GRANT
    o.name,
    p.permission_name;
GO

-- Test that we can't access other tables
PRINT '';
PRINT '=== VERIFICATION: Cannot access other tables ===';
SELECT HAS_PERMS_BY_NAME('ebxQuote', 'OBJECT', 'SELECT') AS [Can SELECT ebxQuote (should be 1)],
       HAS_PERMS_BY_NAME('ebxQuote', 'OBJECT', 'INSERT') AS [Can INSERT ebxQuote (should be 0)],
       HAS_PERMS_BY_NAME('sys.tables', 'OBJECT', 'SELECT') AS [Can SELECT sys.tables (should be 0)];
GO

PRINT '';
PRINT 'Setup complete. Update .env with:';
PRINT '  DB_USER=leango_gateway_ro';
PRINT '  DB_PASSWORD=<the password you set>';
GO
