import io
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

import triggerDeploy as client
import triggerHost as host
from triggerProtocol import signature, validate

SECRET = "a"*64
DIGEST = "sha256:"+"b"*64
EVENT = {"action": "deploy", "id": "c"*32, "digest": DIGEST, "ts": 100}


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
            self.assertEqual(host.dispatch(EVENT | {"digest": "sha256:"+"d"*64}), (409, "unavailable"))
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
            host.store(path, {"digest": DIGEST, "status": "queued"})
            command.side_effect = [MagicMock(returncode=75), MagicMock(returncode=0)]
            host.job(EVENT["id"])
            self.assertEqual(json.loads(path.read_text())["status"], "succeeded")
            self.assertEqual(command.call_count, 2)
            wait.assert_called_once_with(5)
            self.assertEqual(command.call_args.args[0][-2:], ["--deploy", DIGEST])

    def test_busy_job_deadline_and_nonretryable_failure(self):
        for code in (75, 1, 3):
            with tempfile.TemporaryDirectory() as temp, patch.object(host, "STATE", Path(temp)), \
                    patch.object(host.subprocess, "run", return_value=MagicMock(returncode=code)) as command, \
                    patch.object(host.time, "monotonic", side_effect=[0, 601]):
                path = host.record_path(EVENT["id"])
                host.store(path, {"digest": DIGEST, "status": "queued"})
                if code == 3:
                    host.job(EVENT["id"])
                else:
                    with self.assertRaises(SystemExit):
                        host.job(EVENT["id"])
                self.assertEqual(json.loads(path.read_text())["status"], "needs_approval" if code == 3 else "failed")
                command.assert_called_once()


class DeploymentClientTests(unittest.TestCase):
    def test_deploy_and_status_use_explicit_user_agent_and_valid_signature(self):
        for action in ("deploy", "status"):
            with self.subTest(action=action), patch.object(client, "build_opener") as opener, \
                    patch.object(client.time, "time", return_value=100):
                response = opener.return_value.open.return_value.__enter__
                response.return_value = io.BytesIO(b'{"status":"queued"}')
                self.assertEqual(client.call(SECRET, DIGEST, EVENT["id"], action), "queued")
                req = opener.return_value.open.call_args.args[0]
                self.assertEqual(req.full_url, client.URL)
                self.assertEqual(req.get_method(), "POST")
                self.assertEqual(req.get_header("User-agent"), "TodoCal-Deployment/1.0")
                self.assertEqual(validate(SECRET, req.data,
                                          req.get_header("X-todocal-deploy-signature"), 100),
                                 EVENT | {"action": action})
                self.assertIsInstance(opener.call_args.args[0], client.NoRedirect)
                self.assertEqual(opener.return_value.open.call_args.kwargs["timeout"], 15)

    def test_public_readiness_uses_same_user_agent_without_credentials(self):
        with patch.dict(client.os.environ, {"DEPLOY_TRIGGER_SECRET": SECRET, "DEPLOY_DIGEST": DIGEST}), \
                patch.object(client, "call", return_value="succeeded"), \
                patch.object(client, "build_opener") as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'{"status":"ready"}'
            client.main()
            req = opener.return_value.open.call_args.args[0]
            self.assertEqual(req.full_url, client.READY_URL)
            self.assertEqual(req.get_method(), "GET")
            self.assertEqual(req.get_header("User-agent"), "TodoCal-Deployment/1.0")
            self.assertIsNone(req.get_header("X-todocal-deploy-signature"))
            self.assertIsNone(req.get_header("Authorization"))
            self.assertIsNone(req.data)
            self.assertIsInstance(opener.call_args.args[0], client.NoRedirect)

    def test_redirects_are_not_followed(self):
        self.assertIsNone(client.NoRedirect().redirect_request())


if __name__ == "__main__":
    unittest.main()
