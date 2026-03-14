CREATE DATABASE SocialScheduler;
GO

USE SocialScheduler;
GO

CREATE TABLE Posts (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Platform NVARCHAR(50) NOT NULL,
    Message NVARCHAR(MAX),
    PostDate DATETIME NOT NULL,
    CreatedAt DATETIME DEFAULT GETDATE()
);
GO

INSERT INTO Posts (Platform, Message, PostDate)
VALUES ('Facebook', 'Test din SQL Server', GETDATE());
GO