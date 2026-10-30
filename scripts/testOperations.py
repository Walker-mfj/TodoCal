#!/usr/bin/env python3
"""Disposable PostgreSQL migration, restart and backup/restore acceptance."""
import os
from pathlib import Path
import subprocess
import socket
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
NAME = 'focus-acceptance-' + uuid.uuid4().hex[:12]
api = None
created = False


def run(*args, input=None):
    return subprocess.check_output(args, input=input, cwd=ROOT, stderr=subprocess.STDOUT).decode().strip()


def sql(query, database='acceptance_test'):
    return run('docker', 'exec', '-i', NAME, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database, '-At', input=query.encode())


def wait_database():
    for _ in range(60):
        try:
            if sql('SELECT 1') == '1':
                return
        except subprocess.CalledProcessError:
            pass
        time.sleep(.5)
    raise RuntimeError('Disposable database did not become ready')


def fingerprint(database='acceptance_test'):
    tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename", database).splitlines()
    return {table: sql(f'SELECT COALESCE(jsonb_agg(row ORDER BY row::text),\'[]\'::jsonb) FROM (SELECT to_jsonb(t) AS row FROM "{table}" t) x', database) for table in tables}


try:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        database_port = sock.getsockname()[1]
    run('docker', 'run', '-d', '--name', NAME, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=acceptance_test', '-p', f'127.0.0.1:{database_port}:5432', 'postgres:18.3-alpine')
    created = True
    wait_database()
    port = run('docker', 'port', NAME, '5432/tcp').rsplit(':', 1)[1]
    migrations = ROOT / 'apps/api/internal/database/migrations'
    versions = sorted(migrations.glob('*.up.sql'))
    latest_version = int(versions[-1].name.split('_', 1)[0])
    for migration in versions[:5]:
        sql(migration.read_text())
    sql("""CREATE TABLE schema_migrations(version bigint PRIMARY KEY, dirty boolean NOT NULL);
INSERT INTO schema_migrations VALUES (5,false);
INSERT INTO users(id,email,password_hash) VALUES ('00000000-0000-0000-0000-000000000001','recovery@example.invalid','synthetic-fixture');
INSERT INTO settings(user_id) SELECT id FROM users;
INSERT INTO tasks(user_id,id,title,scheduled_date,created_at,updated_at) SELECT id,'00000000-0000-0000-0000-000000000002','Retained task','2026-10-19',now(),now() FROM users;
INSERT INTO daily_snapshots SELECT id,'2026-10-19','UTC',1,0,now() FROM users;
INSERT INTO daily_plan_entries SELECT user_id,'2026-10-19',id,to_jsonb(tasks) FROM tasks;
INSERT INTO focus_sessions(user_id,id,task_id,task_title,kind,status,target_seconds,started_at,ended_at,accumulated_us,pomodoros) SELECT user_id,'00000000-0000-0000-0000-000000000003',id,title,'focus','completed',1500,now()-interval '25 minutes',now(),1500000000,1 FROM tasks;
INSERT INTO focus_intervals SELECT user_id,id,1,started_at,ended_at FROM focus_sessions;""")
    before = fingerprint()
    env = {**os.environ, 'DATABASE_URL': f'postgres://postgres@127.0.0.1:{port}/acceptance_test?sslmode=disable', 'APP_ORIGIN': 'http://localhost:3000', 'COOKIE_SECURE': 'false'}
    subprocess.run([str(ROOT / '.local/focus-api'), '-migrate'], env=env, cwd=ROOT, check=True)
    assert sql('SELECT version FROM schema_migrations') == str(latest_version)
    assert sql('SELECT count(*) FROM focus_sessions WHERE sequence > 0') == '1'
    rollback = '\n'.join(migration.with_name(migration.name.replace('.up.sql', '.down.sql')).read_text()
                         for migration in reversed(versions[5:]))
    sql('BEGIN;\n' + rollback + '\nUPDATE schema_migrations SET version=5; COMMIT;')
    assert fingerprint() == before, 'Rollback changed pre-existing rows'
    subprocess.run([str(ROOT / '.local/focus-api'), '-migrate'], env=env, cwd=ROOT, check=True)
    subprocess.run([str(ROOT / '.local/focus-api'), '-migrate'], env=env, cwd=ROOT, check=True)
    expected = fingerprint()
    print(f'PASS migration 5 -> {latest_version} -> 5 -> {latest_version} and repeated migration; fixture data preserved', flush=True)
    # The API chooses an unused loopback port; only this disposable DB is stopped.
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        api_port = sock.getsockname()[1]
    env['API_ADDR'] = f'127.0.0.1:{api_port}'
    with tempfile.TemporaryFile() as log:
        api = subprocess.Popen([str(ROOT / '.local/focus-api')], env=env, cwd=ROOT, stdout=log, stderr=log)
        def ready(expected_status):
            for _ in range(40):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{api_port}/readyz', timeout=2) as response:
                        status = response.status
                except urllib.error.HTTPError as error:
                    status = error.code
                except (OSError, urllib.error.URLError):
                    status = None
                if status == expected_status:
                    return
                time.sleep(.25)
            raise AssertionError(f'Readiness never reached {expected_status}')
        ready(200)
        run('docker', 'stop', '-t', '2', NAME)
        ready(503)
        run('docker', 'start', NAME)
        wait_database()
        ready(200)
        assert api.poll() is None
        assert fingerprint() == expected, 'Restart changed persisted data'
        print('PASS PostgreSQL outage reports 503; same API reconnects after restart without data loss', flush=True)
    dump = subprocess.check_output(['docker', 'exec', NAME, 'pg_dump', '-U', 'postgres', '-d', 'acceptance_test', '-Fc'])
    run('docker', 'exec', NAME, 'createdb', '-U', 'postgres', 'restored_test')
    run('docker', 'exec', '-i', NAME, 'pg_restore', '-U', 'postgres', '-d', 'restored_test', '--exit-on-error', input=dump)
    assert fingerprint('restored_test') == expected, 'Restored rows differ'
    assert sql("SELECT nextval(pg_get_serial_sequence('focus_sessions','sequence'))", 'restored_test') == '2'
    print('PASS pg_dump/pg_restore: all public table contents and identity sequence preserved', flush=True)
finally:
    if api is not None:
        api.terminate()
        api.wait(timeout=15)
    if created:
        run('docker', 'rm', '-f', '-v', NAME)
