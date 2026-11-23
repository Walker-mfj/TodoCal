"""Test E2E runner cleanup with fake tools; never contact Docker/Postgres."""
import os
import base64
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
MOCK = r'''#!/usr/bin/env python3
import os, sys, signal, time, secrets
from pathlib import Path
root = Path(os.environ['MOCK_ROOT'])
name, args = Path(sys.argv[0]).name, sys.argv[1:]
mode = os.environ['MOCK_MODE']
def log(s):
    with (root / 'events').open('a') as f: f.write(s + '\n')
def server(kind):
    (root / (kind + '.pid')).write_text(str(os.getpid()))
    def stop(*_):
        log('stopped ' + kind)
        sys.exit(0)
    signal.signal(signal.SIGTERM, stop)
    while True: time.sleep(.01)
if name == 'docker':
    log('docker ' + ' '.join(args))
    if 'port' in args: print('127.0.0.1:55432')
    if 'createdb' in args and mode == 'create-fail': sys.exit(17)
    if 'dropdb' in args:
        for kind in ['api', 'web']:
            p = root / (kind + '.pid')
            if p.exists():
                try: os.kill(int(p.read_text()), 0)
                except ProcessLookupError: pass
                else: log('ERROR server alive at drop'); sys.exit(90)
        if mode == 'drop-fail': sys.exit(21)
elif name == 'go':
    if mode == 'go-fail': sys.exit(18)
    target = Path(args[args.index('-o') + 1])
    target.write_text(Path(__file__).read_text())
    target.chmod(0o755)
elif name == 'focus-api-e2e':
    if '-migrate' in args:
        log('migrate ' + os.environ['DATABASE_URL'])
        if mode == 'migrate-fail': sys.exit(19)
    else: server('api')
elif name == 'node':
    if '-p' in args: print(secrets.token_hex(12))
    else: server('web')
elif name == 'npm':
    log('npm ' + ' '.join(args))
    if 'build' in args and mode == 'build-fail': sys.exit(20)
    if 'test:e2e' in args and mode == 'test-fail': sys.exit(23)
    if 'test:e2e' in args and mode in ['signal', 'signal-int']:
        os.kill(int((root / 'runner.pid').read_text()), signal.SIGINT if mode == 'signal-int' else signal.SIGTERM)
        time.sleep(.1)
elif name == 'curl':
    if mode == 'readiness-fail': sys.exit(1)
    if not all((root / (k + '.pid')).exists() for k in ['api', 'web']): sys.exit(1)
elif name == 'sleep': time.sleep(.03)
'''


class RunnerLifecycle(unittest.TestCase):
    def run_case(self, mode, expected, drop=True):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for d in ['scripts', 'apps/api', 'apps/web', 'bin']:
                (root / d).mkdir(parents=True)
            shutil.copy(ROOT / 'scripts/testE2e.sh', root / 'scripts/testE2e.sh')
            (root / 'scripts/e2ePushEnv.sh').write_text(':\n')
            for name in ['docker', 'go', 'node', 'npm', 'curl', 'sleep']:
                tool = root / 'bin' / name
                tool.write_text(MOCK)
                tool.chmod(0o755)
            env = dict(os.environ, MOCK_ROOT=folder, MOCK_MODE=mode,
                       PATH=str(root / 'bin') + os.pathsep + os.environ['PATH'])
            env.pop('E2E_PLAYWRIGHT_IMAGE', None)
            with subprocess.Popen(['sh', str(root / 'scripts/testE2e.sh')], env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True) as process:
                (root / 'runner.pid').write_text(str(process.pid))
                output, _ = process.communicate(timeout=15)
            self.assertEqual(process.returncode, expected, output)
            events = (root / 'events').read_text().splitlines()
            self.assertFalse(any(e.startswith('ERROR') for e in events), events)
            creates = [e for e in events if ' createdb ' in e]
            self.assertEqual(len(creates), 1)
            database = creates[0].split()[-1]
            self.assertRegex(database, r'^focus_web_test_[0-9a-f]{24}$')
            drops = [e for e in events if ' dropdb ' in e]
            self.assertEqual(len(drops), int(drop), events)
            if drop:
                self.assertEqual(drops[0].split()[-1], database)
            self.assertFalse(any('compose down' in e or 'volume rm' in e for e in events))
            for kind in ['api', 'web']:
                if (root / (kind + '.pid')).exists():
                    self.assertLess(events.index('stopped ' + kind), events.index(drops[0]))
            return database

    def test_success_and_unique_database(self):
        self.assertNotEqual(self.run_case('success', 0), self.run_case('success', 0))

    def test_failures_preserve_exit_code_and_cleanup(self):
        for mode, status in [('go-fail', 18), ('migrate-fail', 19),
                             ('build-fail', 20), ('test-fail', 23),
                             ('readiness-fail', 1), ('signal', 143), ('signal-int', 130)]:
            with self.subTest(mode=mode):
                self.run_case(mode, status)

    def test_failed_creation_never_drops_unowned_database(self):
        self.run_case('create-fail', 17, drop=False)

    def test_cleanup_failure_is_not_silent(self):
        self.run_case('drop-fail', 1)


class PushIdentity(unittest.TestCase):
    def test_short_private_scalar_is_padded_and_matches_public_key(self):
        # Force the leading-zero case instead of relying on random generation.
        with tempfile.TemporaryDirectory() as folder:
            preload = Path(folder) / 'short-key.cjs'
            preload.write_text("""
const crypto = require('node:crypto');
const original = crypto.createECDH;
crypto.createECDH = (...args) => {
  const key = original(...args);
  key.setPrivateKey(Buffer.from([1]));
  key.generateKeys = () => key.getPublicKey();
  return key;
};
""")
            env = dict(os.environ, NODE_OPTIONS='--require=' + str(preload))
            result = subprocess.run(
                ['sh', '-c', '. ./scripts/e2ePushEnv.sh; printf "%s\\n%s\\n" "$VAPID_PRIVATE_KEY" "$VAPID_PUBLIC_KEY"'],
                cwd=ROOT, env=env, capture_output=True, text=True, check=True)
            private, public = result.stdout.splitlines()
            decode = lambda value: base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
            self.assertEqual(decode(private), bytes(31) + b'\x01')
            # Standard P-256 generator: public key for private scalar 1.
            self.assertEqual(decode(public).hex(),
                             '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'
                             '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')


if __name__ == '__main__':
    unittest.main()
