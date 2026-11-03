ALTER TABLE settings ADD COLUMN timer_sound text NOT NULL DEFAULT 'classic' CHECK (timer_sound IN ('classic', 'bell', 'soft_bell', 'double_bell', 'singing_bowl', 'doorbell', 'chime', 'digital'));
