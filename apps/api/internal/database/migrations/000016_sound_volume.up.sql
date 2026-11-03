ALTER TABLE settings ADD COLUMN sound_volume integer NOT NULL DEFAULT 75 CHECK(sound_volume BETWEEN 0 AND 100);
