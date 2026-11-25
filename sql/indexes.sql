-- Run once on DB_EMS_Dixon — makes date-range scan queries fast (biggest speed-up).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ScanStatus_ScanDate' AND object_id = OBJECT_ID('dbo.ScanStatus'))
    CREATE INDEX IX_ScanStatus_ScanDate ON dbo.ScanStatus (ScanDate) INCLUDE (MMId, Status);

IF OBJECT_ID('dbo.Tab_FalseScan') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FalseScan_ErrorDateTime' AND object_id = OBJECT_ID('dbo.Tab_FalseScan'))
    CREATE INDEX IX_FalseScan_ErrorDateTime ON dbo.Tab_FalseScan (ErrorDateTime) INCLUDE (MMId);
