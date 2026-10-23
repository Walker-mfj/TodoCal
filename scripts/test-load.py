#!/usr/bin/env python3
"""Isolated, bounded local acceptance load; never reads DATABASE_URL or app data."""
import concurrent.futures as futures
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
NAME = 'focus-load-' + uuid.uuid4().hex[:12]
TODAY = dt.datetime.now(dt.timezone.utc).date()
USERS = [str(uuid.uuid4()) for _ in range(8)]
TOKENS = [uuid.uuid4().hex + uuid.uuid4().hex for _ in USERS]
CSRF = [hashlib.sha256(('csrf:' + token).encode()).hexdigest() for token in TOKENS]
SAMPLES = []
LOCK = threading.Lock()
TIMEOUT = 30
P95_LIMIT_MS = 1000
MAX_LIMIT_MS = 3000
api = None
created = False
base = ''


def run(*args, input=None, cwd=ROOT, timeout=120):
    return subprocess.check_output(args, input=input, cwd=cwd, stderr=subprocess.STDOUT, timeout=timeout).decode().strip()


def sql(query):
    return run('docker', 'exec', '-i', NAME, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'load_test', '-At', input=query.encode())


def request(user, path, body=None, expected=(200,), label=None, key=None):
    headers = {'Cookie': 'focus_session=' + TOKENS[user], 'Origin': 'http://localhost:3000'}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers.update({'Content-Type': 'application/json', 'X-CSRF-Token': CSRF[user], 'Idempotency-Key': key or str(uuid.uuid4())})
    start = time.perf_counter()
    try:
        try:
            with urllib.request.urlopen(urllib.request.Request(base + '/api/v1' + path, data=data, headers=headers), timeout=TIMEOUT) as response:
                status, raw = response.status, response.read()
                assert response.headers.get('X-Account-ID') == USERS[user], 'Account response mismatch'
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        result = json.loads(raw)
        assert status in expected, (path, status, result)
        ok = True
        return status, result
    except Exception:
        ok = False
        raise
    finally:
        if label:
            with LOCK:
                SAMPLES.append({'operation': label, 'ms': (time.perf_counter() - start) * 1000, 'ok': ok})


def seed():
    # Synthetic settled history avoids benchmarking first-login catch-up by accident.
    # Task history and snapshot entries use the API's camelCase serialized shape.
    for i, user in enumerate(USERS):
        count = 10000 if i == 0 else 1000
        sha = lambda value: hashlib.sha256(value.encode()).hexdigest()
        sql(f"""
INSERT INTO users(id,email,password_hash,created_at) VALUES ('{user}','load-{i}@example.invalid','not-a-login-hash',CURRENT_DATE-365);
INSERT INTO settings(user_id) VALUES ('{user}');
INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at) VALUES (gen_random_uuid(),'{user}','{sha(TOKENS[i])}','{sha(CSRF[i])}',now()+interval '1 day');
INSERT INTO planning_state VALUES ('{user}',CURRENT_DATE-1);
INSERT INTO tasks(user_id,id,title,scheduled_date,created_at,updated_at)
SELECT '{user}',gen_random_uuid(),'Account {i} task '||n,CASE WHEN n%3=0 THEN CURRENT_DATE+(n%31) ELSE NULL END,now()-interval '366 days',now() FROM generate_series(1,{count}) n;
CREATE TEMP TABLE fixture_tasks AS SELECT *,row_number() OVER(ORDER BY id) n FROM tasks WHERE user_id='{user}';
INSERT INTO daily_snapshots SELECT '{user}',CURRENT_DATE-n,'UTC',10,0,now() FROM generate_series(1,365) n;
INSERT INTO daily_plan_entries SELECT '{user}',CURRENT_DATE-d,id,jsonb_build_object('task',jsonb_build_object('id',id,'title',title,'priority',priority,'description','','status','incomplete','revision',1,'scheduledDate',(CURRENT_DATE-d)::text,'createdAt',created_at,'updatedAt',updated_at)) FROM fixture_tasks CROSS JOIN generate_series(1,365) d WHERE n<=10;
INSERT INTO task_events(user_id,id,task_id,kind,occurred_at,local_date,timezone,after_state) SELECT '{user}',gen_random_uuid(),task_id,'created',date::timestamptz,date,'UTC',task_state->'task' FROM daily_plan_entries WHERE user_id='{user}';
INSERT INTO focus_sessions(user_id,id,task_title,kind,status,target_seconds,started_at,ended_at,accumulated_us,pomodoros)
SELECT '{user}',gen_random_uuid(),'Historical focus','focus','completed',1500,(CURRENT_DATE-d)::timestamptz+interval '8 hours'+n*interval '30 minutes',(CURRENT_DATE-d)::timestamptz+interval '8 hours 25 minutes'+n*interval '30 minutes',1500000000,1 FROM generate_series(1,365) d CROSS JOIN generate_series(0,9) n;
INSERT INTO focus_intervals SELECT user_id,id,1,started_at,ended_at FROM focus_sessions WHERE user_id='{user}';
INSERT INTO recurrence_series(user_id,id,template,start_date,cadence,interval_days,created_at)
SELECT '{user}',gen_random_uuid(),jsonb_build_object('title','Account {i} recurring '||n,'priority','medium','description','','scheduledDate',CURRENT_DATE::text),CURRENT_DATE,'daily',1,now() FROM generate_series(1,20) n;
""")
    sql('ANALYZE;')


def summarize():
    result = {}
    for name in sorted({s['operation'] for s in SAMPLES}):
        rows = [s for s in SAMPLES if s['operation'] == name]
        values = sorted(s['ms'] for s in rows)
        result[name] = {'requests': len(rows), 'errors': sum(not s['ok'] for s in rows),
                        'p50_ms': round(values[math.ceil(len(values)*.5)-1], 2),
                        'p95_ms': round(values[math.ceil(len(values)*.95)-1], 2), 'max_ms': round(max(values), 2)}
    return result


def main():
    global api, created, base
    # Build our own binary; other verification agents can use their own binary/database.
    (ROOT / '.local').mkdir(exist_ok=True)
    binary = ROOT / '.local/focus-api-load'
    run('go', 'build', '-o', str(binary), './cmd/api', cwd=ROOT / 'apps/api')
    run('docker', 'run', '-d', '--name', NAME, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=load_test', '-p', '127.0.0.1::5432', 'postgres:18.3-alpine')
    created = True
    for _ in range(60):
        try:
            if sql('SELECT 1') == '1':
                break
        except subprocess.CalledProcessError:
            pass
        time.sleep(.5)
    else:
        raise RuntimeError('Disposable database did not start')
    db_port = run('docker', 'port', NAME, '5432/tcp').rsplit(':', 1)[1]
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        api_port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{api_port}'
    env = {**os.environ, 'DATABASE_URL': f'postgres://postgres@127.0.0.1:{db_port}/load_test?sslmode=disable', 'APP_ORIGIN': 'http://localhost:3000', 'COOKIE_SECURE': 'false', 'API_ADDR': f'127.0.0.1:{api_port}'}
    subprocess.run([str(binary), '-migrate'], env=env, cwd=ROOT, check=True, timeout=60)
    seed()
    with tempfile.TemporaryFile() as log:
        api = subprocess.Popen([str(binary)], env=env, cwd=ROOT, stdout=log, stderr=log)
        for _ in range(80):
            try:
                with urllib.request.urlopen(base + '/readyz', timeout=2) as response:
                    if response.status == 200:
                        break
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(.25)
        else:
            log.seek(0)
            raise RuntimeError(log.read().decode())
        start, end = TODAY.isoformat(), (TODAY + dt.timedelta(days=31)).isoformat()
        calendar_path = f'/calendar?from={start}&to={end}'
        # Measure uncached materialization separately from the mixed steady-state workload.
        for user in range(8):
            _, calendar = request(user, calendar_path, label='cold_calendar')
            assert len(calendar['days']) == 31
        assert sql('SELECT count(*) FROM tasks WHERE series_id IS NOT NULL') == str(8*20*31)
        # Full keyset traversal catches truncation, duplicates and tenant leakage.
        seen, cursor = set(), ''
        while True:
            _, page = request(0, '/tasks?limit=100' + ('&cursor=' + cursor if cursor else ''))
            for task in page['items']:
                assert task['id'] not in seen
                assert task['title'].startswith('Account 0 ')
                seen.add(task['id'])
            cursor = page.get('nextCursor')
            if not cursor:
                break
        assert len(seen) == 10620, len(seen)
        past = TODAY - dt.timedelta(days=40)
        report_path = '/reports/period?period=month&date=' + past.isoformat()
        def validate_report(report):
            days = len(report['days'])
            assert report['metrics']['planned'] == days*10, report['metrics']
            assert report['metrics']['pomodoros'] == days*10, report['metrics']
            assert report['metrics']['focusSeconds'] == days*15000, report['metrics']
        _, report = request(0, report_path)
        validate_report(report)
        barrier = threading.Barrier(12)
        def worker(worker_id):
            user = worker_id % 8
            barrier.wait(timeout=10)
            for n in range(200):
                kind = n % 5
                if kind == 0:
                    _, page = request(user, '/tasks?limit=100', label='task_list')
                    assert len(page['items']) == 100
                    assert all(t['title'].startswith(f'Account {user} ') for t in page['items'])
                elif kind == 1:
                    _, page = request(user, '/tasks?limit=100&search=does-not-exist', label='task_search_miss')
                    assert page['items'] == []
                elif kind == 2:
                    _, value = request(user, report_path, label='month_report')
                    validate_report(value)
                elif kind == 3:
                    request(user, '/tasks', {'title': f'Account {user} load write {worker_id}-{n}', 'priority': 'medium'}, (201,), 'task_create')
                else:
                    _, value = request(user, calendar_path, label='warm_calendar')
                    assert len(value['days']) == 31
        started = time.perf_counter()
        with futures.ThreadPoolExecutor(max_workers=12) as pool:
            list(pool.map(worker, range(12)))
        mixed_seconds = time.perf_counter() - started
        # All starts hit one account together. Exactly one wins; expected 409s are not errors.
        barrier = threading.Barrier(16)
        def contend(_):
            barrier.wait(timeout=10)
            return request(0, '/focus', {'kind': 'focus'}, (201,409), 'focus_contention')
        with futures.ThreadPoolExecutor(max_workers=16) as pool:
            starts = list(pool.map(contend, range(16)))
        assert sum(status == 201 for status, _ in starts) == 1
        assert sql("SELECT count(*) FROM focus_sessions WHERE status IN ('running','paused')") == '1'
        # Duplicate mutation delivery must produce one persisted task.
        replay_key = str(uuid.uuid4())
        def replay(_):
            return request(0, '/tasks', {'title': 'Account 0 replay sentinel', 'priority': 'medium'}, (201,), 'idempotency_contention', replay_key)[1]['id']
        with futures.ThreadPoolExecutor(max_workers=8) as pool:
            ids = list(pool.map(replay, range(8)))
        assert len(set(ids)) == 1
        assert sql("SELECT count(*) FROM tasks WHERE title='Account 0 replay sentinel'") == '1'
        assert sql("SELECT count(*) FROM tasks WHERE title LIKE '%load write%'") == '480'
        assert sql('SELECT count(*) FROM tasks WHERE series_id IS NOT NULL') == str(8*20*31)
        # Independent user must not read the task just created by account 0.
        request(1, '/tasks/' + ids[0], expected=(404,))
        summary = summarize()
        thresholds_pass = all(s['errors'] == 0 and s['p95_ms'] <= P95_LIMIT_MS and s['max_ms'] <= MAX_LIMIT_MS for s in summary.values())
        output = {'utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'environment': {'platform': platform.platform(), 'cpu_count': os.cpu_count(), 'go': run('go','version'), 'postgres': sql('SELECT version()'), 'docker': run('docker','info','--format','{{.NCPU}} CPUs, {{.MemTotal}} bytes memory; {{.OperatingSystem}}'), 'cpu': run('sysctl','-n','machdep.cpu.brand_string') if platform.system() == 'Darwin' else platform.processor(), 'host_memory_bytes': run('sysctl','-n','hw.memsize') if platform.system() == 'Darwin' else 'unknown'}, 'dataset': {'users':8,'base_tasks':17000,'large_account_base_tasks':10000,'recurrence_series':160,'materialized_occurrences':4960,'history_days_per_user':365,'snapshots':2920,'snapshot_entries':29200,'task_events':29200,'historical_focus_sessions':29200,'historical_focus_intervals':29200}, 'mixed': {'workers':12,'requests':2400,'seconds':round(mixed_seconds,2),'requests_per_second':round(2400/mixed_seconds,2)}, 'thresholds': {'p95_ms':P95_LIMIT_MS,'max_ms':MAX_LIMIT_MS,'http_timeout_seconds':TIMEOUT}, 'operations':summary,'correctness':'passed','latency_acceptance':thresholds_pass}
        print(json.dumps(output, indent=2), flush=True)
        (ROOT / '.local/load-results.json').write_text(json.dumps(output, indent=2)+'\n')
        assert thresholds_pass, 'Local latency acceptance failed; inspect reported per-operation distribution'


if __name__ == '__main__':
    try:
        main()
    finally:
        if api is not None:
            api.terminate()
            try:
                api.wait(timeout=15)
            except subprocess.TimeoutExpired:
                api.kill()
                api.wait(timeout=5)
        if created:
            run('docker', 'rm', '-f', '-v', NAME, timeout=30)
