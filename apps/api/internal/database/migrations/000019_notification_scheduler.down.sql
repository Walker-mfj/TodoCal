DROP INDEX focus_running_deadlines;
DROP INDEX notification_finished_retention;
DROP TABLE notification_maintenance;
DROP TRIGGER notification_recurrence_changed ON recurrence_series;
DROP TRIGGER notification_preferences_changed ON notification_preferences;
DROP TRIGGER notification_settings_changed ON settings;
DROP FUNCTION invalidate_notification_horizon();
DROP TABLE notification_horizons;
