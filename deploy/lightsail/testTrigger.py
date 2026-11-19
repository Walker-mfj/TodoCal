import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
