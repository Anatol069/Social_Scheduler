USE SocialScheduler;
GO

-- 1. Adaugă coloana pentru ID-ul Google
ALTER TABLE Users ADD GoogleId NVARCHAR(255);

-- 2. Adaugă coloana pentru Email (dacă nu există deja)
ALTER TABLE Users ADD Email NVARCHAR(255);

-- 3. Modifică parola să fie opțională (NULL)
-- Utilizatorii Google nu au parolă, deci câmpul trebuie să accepte valori goale
ALTER TABLE Users ALTER COLUMN Password NVARCHAR(255) NULL;
GO