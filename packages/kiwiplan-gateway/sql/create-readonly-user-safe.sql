-- ============================================================================
-- KIWIPLAN GATEWAY - READ-ONLY SQL USER SETUP (SAFE VERSION)
-- ============================================================================
-- No DROP statements - only creates new objects
-- Run this AFTER confirming user does not exist with check-user-exists.js
-- ============================================================================

-- Step 1: Create server login
USE master;
GO

CREATE LOGIN leango_gateway_ro
    WITH PASSWORD = 'CHANGE_THIS_PASSWORD',
    DEFAULT_DATABASE = esp,
    CHECK_POLICY = ON;
GO

PRINT 'Server login created: leango_gateway_ro';
GO

-- Step 2: Create database user
USE esp;
GO

CREATE USER leango_gateway_ro FOR LOGIN leango_gateway_ro;
GO

PRINT 'Database user created in esp: leango_gateway_ro';
GO

-- Step 3: Grant full read access via db_datareader role
ALTER ROLE db_datareader ADD MEMBER leango_gateway_ro;

PRINT 'Added to db_datareader role (SELECT on all tables)';
GO

-- Step 4: Grant schema exploration
GRANT VIEW DEFINITION TO leango_gateway_ro;

PRINT 'Granted VIEW DEFINITION (schema exploration)';
GO

-- Step 5: DENY all write operations at database level
DENY INSERT TO leango_gateway_ro;
DENY UPDATE TO leango_gateway_ro;
DENY DELETE TO leango_gateway_ro;
DENY CREATE TABLE TO leango_gateway_ro;
DENY ALTER ANY SCHEMA TO leango_gateway_ro;
DENY EXECUTE TO leango_gateway_ro;

PRINT 'Database-level DENY applied for all write operations';
GO

PRINT '';
PRINT 'Setup complete. Update .env with:';
PRINT '  DB_USER=leango_gateway_ro';
PRINT '  DB_PASSWORD=<the password you set>';
GO
