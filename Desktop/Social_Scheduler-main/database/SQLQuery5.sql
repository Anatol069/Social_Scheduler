CREATE TABLE SocialCredentials (
    UserId INT PRIMARY KEY FOREIGN KEY REFERENCES Users(Id),
    -- Facebook
    FbAppId NVARCHAR(255),
    FbPageId NVARCHAR(255),
    FbAppSecret NVARCHAR(255),
    FbAccessToken NVARCHAR(MAX),
    FbAutoPost BIT DEFAULT 0,
    -- Twitter (X)
    TwAccountId NVARCHAR(255),
    TwApiKey NVARCHAR(255),
    TwApiSecret NVARCHAR(255),
    TwAccessToken NVARCHAR(255),
    TwAccessSecret NVARCHAR(255),
    TwAutoPost BIT DEFAULT 0
);