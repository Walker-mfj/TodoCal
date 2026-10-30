package repository

const TaskColumns = `id::text,title,description,group_id::text,priority,scheduled_date::text,to_char(start_time,'HH24:MI'),to_char(end_time,'HH24:MI'),deadline,estimated_pomodoros,status,revision,created_at,updated_at,series_id::text,original_occurrence_date::text,focus_minutes,completed_at,deleted_at,
 COALESCE((SELECT sum(f.accumulated_us)/1000000 FROM focus_sessions f WHERE f.user_id=tasks.user_id AND f.task_id=tasks.id AND f.kind='focus'),0)::bigint,
 COALESCE((SELECT sum(f.accumulated_us::numeric/(f.target_seconds*1000000)) FROM focus_sessions f WHERE f.user_id=tasks.user_id AND f.task_id=tasks.id AND f.kind='focus' AND f.status IN ('completed','ended')),0)::double precision,
 (SELECT r.cadence FROM recurrence_series r WHERE r.user_id=tasks.user_id AND r.id=tasks.series_id),
 (SELECT r.interval_days FROM recurrence_series r WHERE r.user_id=tasks.user_id AND r.id=tasks.series_id)`
const focusColumns = `id::text,task_id::text,task_title,kind,status,target_seconds,accumulated_us,running_since,started_at,ended_at,pomodoros,revision`
