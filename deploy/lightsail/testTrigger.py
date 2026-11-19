import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

import triggerHost as host
from triggerProtocol import signature, validate

SECRET = "a"*64
TAG = "api-"+"b"*40
EVENT = {"action": "deploy", "id": "c"*32, "tag": TAG, "ts": 100}


class TriggerTests(unittest.TestCase):
    def test_signed_request_and_replay_window(self):
        body = json.dumps(EVENT).encode()
        self.assertEqual(validate(SECRET, body, signature(SECRET, body), 100), EVENT)
        for sig, now in [("0"*64, 100), (signature(SECRET, body), 221)]:
            with self.assertRaises(ValueError):
                validate(SECRET, body, sig, now)

    def test_idempotent_and_exact_tag(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(host, "STATE", Path(temp)), \
                patch.object(host.subprocess, "run") as command:
            self.assertEqual(host.dispatch(EVENT), (200, "queued"))
            self.assertEqual(host.dispatch(EVENT), (200, "queued"))
            self.assertEqual(host.dispatch(EVENT | {"action": "status"}), (200, "queued"))
            self.assertEqual(host.dispatch(EVENT | {"tag": "api-"+"d"*40}), (409, "unavailable"))
            command.assert_called_once()

    def test_status_does_not_start_job(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(host, "STATE", Path(temp)), \
                patch.object(host.subprocess, "run") as command:
            self.assertEqual(host.dispatch(EVENT | {"action": "status"}), (200, "unknown"))
            command.assert_not_called()

    def test_busy_job_retries_then_succeeds(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(host, "STATE", Path(temp)), \
                patch.object(host.subprocess, "run") as command, patch.object(host.time, "sleep") as wait:
            path = host.record_path(EVENT["id"])
            host.store(path, {"tag": TAG, "status": "queued"})
            command.side_effect = [MagicMock(returncode=75), MagicMock(returncode=0)]
            host.job(EVENT["id"])
            self.assertEqual(json.loads(path.read_text())["status"], "succeeded")
            self.assertEqual(command.call_count, 2)
            wait.assert_called_once_with(5)
            self.assertEqual(command.call_args.args[0][-2:], ["--deploy", TAG])

    def test_busy_job_deadline_and_nonretryable_failure(self):
        for code in (75, 1, 3):
            with tempfile.TemporaryDirectory() as temp, patch.object(host, "STATE", Path(temp)), \
                    patch.object(host.subprocess, "run", return_value=MagicMock(returncode=code)) as command, \
                    patch.object(host.time, "monotonic", side_effect=[0, 601]):
                path = host.record_path(EVENT["id"])
                host.store(path, {"tag": TAG, "status": "queued"})
                if code == 3:
                    host.job(EVENT["id"])
                else:
                    with self.assertRaises(SystemExit):
                        host.job(EVENT["id"])
                self.assertEqual(json.loads(path.read_text())["status"], "needs_approval" if code == 3 else "failed")
                command.assert_called_once()


if __name__ == "__main__":
    unittest.main()
