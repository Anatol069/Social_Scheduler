USE SocialScheduler;
GO

-- Adăugăm coloana pentru calea imaginii
ALTER TABLE Posts
ADD ImagePath NVARCHAR(255) NULL;
GO