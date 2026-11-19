import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from urllib.request import Request

import deploy
import githubRelease as gh

SHA = "a" * 40
FP = "b" * 64
OTHER = "c" * 64


def release():
    return {"tag_name": f"api-{SHA}", "draft": False, "prerelease": False,
            "assets": [{"name": f"todocal-api-{FP}.tar.gz", "size": 3,
                        "id": 42, "state": "uploaded",
                        "digest": "sha256:" + hashlib.sha256(b"abc").hexdigest()}]}


class ReleaseTests(unittest.TestCase):
    def test_release_metadata(self):
        parsed = gh.parse_release(release())
        self.assertEqual(parsed["sha"], SHA)
        self.assertEqual(parsed["fingerprint"], FP)
        for mutation in ({"draft": True}, {"tag_name": "v1"}, {"assets": []}):
            with self.subTest(mutation=mutation), self.assertRaises(gh.DeploymentError):
                gh.parse_release(release() | mutation)

    def test_redirect_does_not_forward_auth(self):
        req = Request(gh.API + "/asset")
        req.add_unredirected_header("Authorization", "Bearer secret")
        handler = gh.SecureRedirect()
        redirected = handler.redirect_request(req, None, 302, "", {},
                                              "https://release-assets.githubusercontent.com/download")
        self.assertIsNone(redirected.get_header("Authorization"))
        with self.assertRaises(gh.DeploymentError):
            handler.redirect_request(req, None, 302, "", {}, "https://other.example/download")

    def test_download_rejects_wrong_checksum(self):
        parsed = gh.parse_release(release())
        client = gh.Client.__new__(gh.Client)
        client.path, client.token = "/repos/example/repo", "private"
        response = MagicMock()
        response.__enter__.return_value.read.side_effect = [b"bad", b""]
        with tempfile.TemporaryDirectory() as temp, patch.object(gh, "request", return_value=response):
            with self.assertRaises(gh.DeploymentError):
                client.download(parsed, Path(temp) / "asset")

    def test_download_accepts_verified_bytes(self):
        parsed = gh.parse_release(release())
        client = gh.Client.__new__(gh.Client)
        client.path, client.token = "/repos/example/repo", "private"
        response = MagicMock()
        response.__enter__.return_value.read.side_effect = [b"abc", b""]
        with tempfile.TemporaryDirectory() as temp, patch.object(gh, "request", return_value=response):
            asset = Path(temp) / "asset"
            client.download(parsed, asset)
            self.assertEqual(asset.read_bytes(), b"abc")


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.release = gh.parse_release(release())
        self.old = {"id": "old", "sha": "d" * 40, "fingerprint": FP}
        self.new = {"id": "new", "sha": SHA, "fingerprint": FP}
        self.client = MagicMock()
        self.client.latest.return_value = self.release
        for name, value in {
            "preflight": self.old, "ready": True, "download_image": self.new,
            "write_hold": None, "clear_hold": None, "command": None,
            "stop_api": None, "activate": None, "prune_old": None,
        }.items():
            patcher = patch.object(deploy, name, return_value=value)
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)

    def test_unknown_or_changed_migrations_wait_for_exact_approval(self):
        for fingerprint in (None, OTHER):
            self.old["fingerprint"] = fingerprint
            deploy.update(self.client, self.release)
        self.download_image.assert_not_called()
        self.stop_api.assert_not_called()
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, self.release, "api-" + "e" * 40)

    def test_already_installed_release_still_checks_readiness(self):
        self.old["sha"] = SHA
        self.ready.return_value = False
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, self.release)
        self.stop_api.assert_not_called()
        self.ready.return_value = True
        self.assertEqual(deploy.update(self.client, self.release), 0)

    def test_successful_schema_compatible_deploy(self):
        deploy.update(self.client, self.release)
        self.write_hold.assert_called_once()
        self.stop_api.assert_called_once()
        self.activate.assert_called_once_with("new")
        self.clear_hold.assert_called_once()
        self.command.assert_called_once_with("docker", "tag", "old", deploy.ROLLBACK)

    def test_compatible_failure_restores_old_and_keeps_hold(self):
        self.activate.side_effect = [gh.DeploymentError("not ready"), None]
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, self.release)
        self.assertEqual([c.args for c in self.activate.call_args_list], [("new",), ("old",)])
        self.clear_hold.assert_not_called()

    def test_migration_failure_does_not_rollback(self):
        self.old["fingerprint"] = OTHER
        self.activate.side_effect = gh.DeploymentError("not ready")
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, self.release, self.release["tag"])
        self.activate.assert_called_once_with("new")
        self.command.assert_any_call(str(deploy.ROOT / "backup.sh"), "frequent", timeout=1800)
        self.clear_hold.assert_not_called()

    def test_failed_backup_restores_old_before_migration(self):
        self.old["fingerprint"] = OTHER
        self.command.side_effect = [None, gh.DeploymentError("backup failed")]
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, self.release, self.release["tag"])
        self.activate.assert_called_once_with("old")
        self.clear_hold.assert_not_called()

    def test_superseded_release_never_stops_api(self):
        self.client.latest.return_value = self.release | {"id": 99}
        with self.assertRaises(gh.DeploymentError):
            deploy.update(self.client, self.release)
        self.stop_api.assert_not_called()

    def test_rollback_refuses_schema_mismatch(self):
        with patch.object(deploy, "image", return_value=self.new | {"fingerprint": OTHER}):
            with self.assertRaises(gh.DeploymentError):
                deploy.rollback()
        self.stop_api.assert_not_called()

    def test_image_identity_validation(self):
        correct = self.new | {"os": "linux", "arch": "amd64"}
        deploy.verify_image(correct, self.release)
        with self.assertRaises(gh.DeploymentError):
            deploy.verify_image(correct | {"arch": "arm64"}, self.release)

class LockTests(unittest.TestCase):
    def test_event_returns_retryable_code_when_host_busy(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(deploy, "STATE", Path(temp)), \
                patch.object(deploy.os, "geteuid", return_value=0), \
                patch.object(deploy.fcntl, "flock", side_effect=BlockingIOError), \
                patch("sys.argv", ["deploy.py", "--deploy", "api-"+SHA]), \
                patch.object(deploy, "Client") as client:
            self.assertEqual(deploy.main(), 75)
            client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
