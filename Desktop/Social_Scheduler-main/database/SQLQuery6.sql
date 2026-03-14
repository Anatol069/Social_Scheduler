-- Adăugăm coloana UserId în tabelul Posts
ALTER TABLE Posts ADD UserId INT;

-- Ștergem postările vechi de test (opțional, dar recomandat)
-- pentru a nu avea erori cu postări care nu aparțin nimănui (UserId = NULL)
DELETE FROM Posts;