import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import deploy
import registry as gh

SHA = "a"*40
FP = "b"*64
OTHER = "c"*64
DIGEST = "sha256:"+"e"*64
REF = gh.IMAGE+"@"+DIGEST


class RegistryTests(unittest.TestCase):
    def test_public_manifest_digest(self):
        body = b'{"schemaVersion":2}'
        digest = "sha256:"+hashlib.sha256(body).hexdigest()
        with patch.object(gh, "read", side_effect=[
            (b'{"token":"anonymous"}', {}),
            (body, {"Docker-Content-Digest":digest,
                    "Content-Type":"application/vnd.oci.image.manifest.v1+json"})]) as read:
            self.assertEqual(gh.Registry().latest(), digest)
            self.assertIn("/manifests/tested", read.call_args.args[0].full_url)
            self.assertEqual(read.call_args.args[0].get_header("Authorization"), "Bearer anonymous")

    def test_reject_mismatched_manifest(self):
        with patch.object(gh, "read", side_effect=[
            (b'{"token":"anonymous"}', {}),
            (b"bad", {"Docker-Content-Digest":DIGEST,
                     "Content-Type":"application/vnd.oci.image.manifest.v1+json"})]):
            with self.assertRaises(gh.DeploymentError):
                gh.Registry().latest()


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.old = {"id":"old", "sha":"d"*40, "fingerprint":FP, "digests":[]}
        self.new = {"id":"new", "sha":SHA, "fingerprint":FP, "digests":[REF],
                    "source":"https://github.com/Walker-mfj/TodoCal", "os":"linux", "arch":"amd64"}
        self.client = MagicMock()
        self.client.latest.return_value = DIGEST
        for name, value in {
            "preflight":self.old, "ready":True, "download_image":self.new,
            "write_hold":None, "clear_hold":None, "command":None,
            "stop_api":None, "activate":None, "prune_old":None,
        }.items():
            p = patch.object(deploy, name, return_value=value)
            setattr(self, name, p.start())
            self.addCleanup(p.stop)

    def test_unknown_or_changed_migrations_wait_for_exact_approval(self):
        for fp in (None, OTHER):
            self.old["fingerprint"] = fp
            self.assertEqual(deploy.update(self.client, DIGEST), 3)
        self.stop_api.assert_not_called()
        self.write_hold.assert_not_called()
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, DIGEST, "sha256:"+"0"*64)

    def test_successful_schema_compatible_deploy(self):
        self.assertEqual(deploy.update(self.client, DIGEST), 0)
        self.write_hold.assert_called_once()
        self.stop_api.assert_called_once()
        self.activate.assert_called_once_with("new")
        self.clear_hold.assert_called_once()
        self.command.assert_called_once_with("docker", "tag", "old", deploy.ROLLBACK)

    def test_compatible_failure_restores_old_and_keeps_hold(self):
        self.activate.side_effect = [gh.DeploymentError("not ready"), None]
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, DIGEST)
        self.assertEqual([c.args for c in self.activate.call_args_list], [("new",), ("old",)])
        self.clear_hold.assert_not_called()

    def test_migration_failure_does_not_rollback(self):
        self.old["fingerprint"] = OTHER
        self.activate.side_effect = gh.DeploymentError("not ready")
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, DIGEST, DIGEST)
        self.activate.assert_called_once_with("new")
        self.command.assert_any_call(str(deploy.ROOT / "backup.sh"), "frequent", timeout=1800)
        self.clear_hold.assert_not_called()

    def test_failed_backup_restores_old_before_migration(self):
        self.old["fingerprint"] = OTHER
        self.command.side_effect = [None, gh.DeploymentError("backup failed")]
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, DIGEST, DIGEST)
        self.activate.assert_called_once_with("old")
        self.clear_hold.assert_not_called()

    def test_superseded_image_never_stops_api(self):
        self.client.latest.return_value = "sha256:"+"0"*64
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, DIGEST)
        self.stop_api.assert_not_called()

    def test_rollback_refuses_schema_mismatch(self):
        with patch.object(deploy, "image", return_value=self.new | {"fingerprint": OTHER}):
            with self.assertRaises(gh.DeploymentError):
                deploy.rollback()
        self.stop_api.assert_not_called()

    def test_already_installed_requires_readiness_and_skips_pull(self):
        self.preflight.return_value = self.new
        self.ready.return_value = False
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, DIGEST)
        self.ready.return_value = True
        self.assertEqual(deploy.update(self.client, DIGEST), 0)
        self.download_image.assert_not_called()
        self.stop_api.assert_not_called()

    def test_matching_legacy_image_id_skips_restart_after_pull(self):
        self.old["id"] = self.new["id"]
        self.assertEqual(deploy.update(self.client, DIGEST), 0)
        self.stop_api.assert_not_called()

    def test_image_identity_validation(self):
        deploy.verify_image(self.new, DIGEST)
        for change in ({"arch":"arm64"}, {"digests":[]}, {"source":"unknown"},
                       {"sha":None}, {"fingerprint":None}):
            with self.assertRaises(gh.DeploymentError):
                deploy.verify_image(self.new | change, DIGEST)


class PullTests(unittest.TestCase):
    def test_pull_uses_only_fixed_registry_and_digest(self):
        candidate = {"digests":[REF], "sha":SHA, "fingerprint":FP,
                     "source":"https://github.com/Walker-mfj/TodoCal", "os":"linux", "arch":"amd64"}
        with patch.object(deploy, "image", side_effect=[subprocess.CalledProcessError(1, "inspect"), candidate]), \
                patch.object(deploy, "command") as command, patch.object(deploy.shutil, "disk_usage") as disk:
            disk.return_value.free = 3*1024**3
            self.assertEqual(deploy.download_image(DIGEST), candidate)
            command.assert_called_once_with("docker", "pull", "--platform", "linux/amd64", REF, timeout=300)

    def test_mutable_tag_is_rejected(self):
        with patch.object(deploy, "command") as command:
            with self.assertRaises(gh.DeploymentError):
                deploy.download_image("tested")
            command.assert_not_called()


class LockTests(unittest.TestCase):
    def test_event_returns_retryable_code_when_host_busy(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(deploy, "STATE", Path(temp)), \
                patch.object(deploy.os, "geteuid", return_value=0), \
                patch.object(deploy.fcntl, "flock", side_effect=BlockingIOError), \
                patch("sys.argv", ["deploy.py", "--deploy", DIGEST]), \
                patch.object(deploy, "Registry") as client:
            self.assertEqual(deploy.main(), 75)
            client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
