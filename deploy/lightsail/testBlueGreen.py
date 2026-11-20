import subprocess
import unittest
from unittest.mock import MagicMock, patch

import blueGreen as bg
from registry import DeploymentError, IMAGE


class BlueGreenTests(unittest.TestCase):
    def setUp(self):
        self.ops = MagicMock()
        self.current = {"id": "old", "sha": "a"*40, "leader": "v1", "digests": []}
        self.candidate = {"id": "new", "sha": "b"*40, "leader": "v1"}

    def test_candidate_ready_and_proxy_drained_before_old_stops(self):
        with patch.multiple(bg, memory_guard=MagicMock(), start=MagicMock(),
                            switch=MagicMock(), stop=MagicMock(), ready=MagicMock(return_value=True)):
            order = MagicMock()
            order.attach_mock(bg.start, "start")
            order.attach_mock(bg.switch, "switch")
            order.attach_mock(bg.stop, "stop")
            bg.handoff(self.ops, "blue", self.current, "green", self.candidate, True)
            self.assertEqual([c[0] for c in order.mock_calls], ["start", "switch", "stop"])
            self.assertEqual(bg.stop.call_args.args[1], "blue")
            self.ops.command.assert_called_once_with("docker", "tag", "old", bg.ROLLBACK_IMAGE)
            self.ops.clear_hold.assert_called_once()

    def test_unready_candidate_never_switches(self):
        with patch.multiple(bg, memory_guard=MagicMock(), start=MagicMock(side_effect=DeploymentError("unready")),
                            switch=MagicMock(), stop=MagicMock(), ready=MagicMock()):
            with self.assertRaises(DeploymentError):
                bg.handoff(self.ops, "blue", self.current, "green", self.candidate, True)
            bg.switch.assert_not_called()
            bg.stop.assert_called_once_with(self.ops, "green")
            self.ops.command.assert_not_called()
            self.ops.clear_hold.assert_not_called()

    def test_ambiguous_reload_keeps_both_slots_and_hold(self):
        with patch.multiple(bg, memory_guard=MagicMock(), start=MagicMock(),
                            switch=MagicMock(side_effect=DeploymentError("drain")),
                            stop=MagicMock(), ready=MagicMock()):
            with self.assertRaises(DeploymentError):
                bg.handoff(self.ops, "blue", self.current, "green", self.candidate, True)
            bg.stop.assert_not_called()
            self.ops.command.assert_not_called()
            self.ops.clear_hold.assert_not_called()

    def test_migration_requires_explicit_approval(self):
        digest = "sha256:"+"c"*64
        self.ops.compatible.return_value = False
        self.ops.download_image.return_value = self.candidate
        client = MagicMock()
        client.latest.return_value = digest
        with patch.object(bg, "preflight", return_value=("blue", self.current)), \
                patch.object(bg, "handoff") as handoff:
            self.assertEqual(bg.update(self.ops, client, digest), 3)
            handoff.assert_not_called()
        self.ops.download_image.assert_called_once_with(digest)

    def test_superseded_digest_never_switches(self):
        digest = "sha256:"+"c"*64
        self.ops.download_image.return_value = self.candidate
        client = MagicMock()
        client.latest.return_value = "sha256:"+"d"*64
        with patch.object(bg, "preflight", return_value=("blue", self.current)), \
                patch.object(bg, "handoff") as handoff:
            with self.assertRaisesRegex(DeploymentError, "Tested digest changed"):
                bg.update(self.ops, client, digest)
            handoff.assert_not_called()

    def test_existing_digest_is_noop(self):
        digest = "sha256:"+"c"*64
        current = self.current | {"digests": [IMAGE+"@"+digest]}
        with patch.object(bg, "preflight", return_value=("blue", current)):
            self.assertEqual(bg.update(self.ops, MagicMock(), digest), 0)
        self.ops.verify_image.assert_called_once_with(current, digest)
        self.ops.download_image.assert_not_called()

    def test_rollback_from_unhealthy_current_api(self):
        with patch.multiple(bg, verify_slots=MagicMock(), active_config=MagicMock(return_value="green"),
                            proxy_slot=MagicMock(return_value="green"), running=MagicMock(return_value=[]),
                            active_image=MagicMock(return_value=self.candidate),
                            ready=MagicMock(return_value=False), handoff=MagicMock()):
            self.ops.image.return_value = self.current
            self.ops.compatible.return_value = True
            with self.assertRaisesRegex(DeploymentError, "Current proxy is not ready"):
                bg.preflight(self.ops)
            bg.ready.reset_mock()
            bg.rollback(self.ops)
            bg.ready.assert_not_called()
            self.ops.image.assert_called_once_with(bg.ROLLBACK_IMAGE)
            bg.handoff.assert_called_once_with(self.ops, "green", self.candidate, "blue",
                                               self.current, True, keep_hold=True)

    def test_rollback_refuses_ambiguous_slot(self):
        with patch.multiple(bg, verify_slots=MagicMock(), active_config=MagicMock(return_value="green"),
                            proxy_slot=MagicMock(return_value="blue"), handoff=MagicMock()):
            with self.assertRaisesRegex(DeploymentError, "Ambiguous proxy"):
                bg.rollback(self.ops)
            bg.handoff.assert_not_called()

    def test_rollback_refuses_incompatible_schema(self):
        self.ops.image.return_value = self.current
        self.ops.compatible.return_value = False
        with patch.multiple(bg, inspect_active=MagicMock(return_value=("green", self.candidate)),
                            handoff=MagicMock()):
            with self.assertRaisesRegex(DeploymentError, "compatible pinned image"):
                bg.rollback(self.ops)
            bg.handoff.assert_not_called()

    def test_failed_candidate_cannot_replace_last_good_rollback_image(self):
        # Exercise real start(), handoff() and rollback() with fake Docker
        # tags and readiness. A -> B succeeds; C overwrites Blue then fails.
        a, b = self.current, self.candidate
        c = {"id": "failed", "sha": "c"*40, "leader": "v1"}
        images = {i["id"]: i for i in (a, b, c)}
        tags = {bg.slot_image("blue"): a["id"]}
        active = ["blue"]

        def docker(*args, **kwargs):
            self.assertEqual(args[:2], ("docker", "tag"))
            tags[args[3]] = args[2]

        def image(ref):
            return images[tags.get(ref, ref)]

        def readiness(ops, service, wait=90):
            return service != "api-blue" or tags[bg.slot_image("blue")] != c["id"]

        self.ops.command.side_effect = docker
        self.ops.image.side_effect = image
        self.ops.compatible.return_value = True
        with patch.multiple(bg, memory_guard=MagicMock(), compose=MagicMock(),
                            active_image=MagicMock(side_effect=lambda ops, slot: image(bg.slot_image(slot))),
                            ready=MagicMock(side_effect=readiness), stop=MagicMock(),
                            switch=MagicMock(side_effect=lambda ops, slot: active.__setitem__(0, slot)),
                            inspect_active=MagicMock(side_effect=lambda ops: (active[0], image(bg.slot_image(active[0]))))):
            bg.handoff(self.ops, "blue", a, "green", b, True)
            self.assertEqual(active[0], "green")
            self.assertEqual(tags[bg.ROLLBACK_IMAGE], a["id"])
            self.ops.prune_old.assert_called_once_with({a["id"], b["id"]})

            with self.assertRaises(DeploymentError):
                bg.handoff(self.ops, "green", b, "blue", c, True)
            self.assertEqual(active[0], "green")
            self.assertEqual(tags[bg.slot_image("blue")], c["id"])
            self.assertEqual(tags[bg.ROLLBACK_IMAGE], a["id"])

            bg.rollback(self.ops)
            self.assertEqual(active[0], "blue")
            self.assertEqual(tags[bg.slot_image("blue")], a["id"])
            self.assertEqual(tags[bg.ROLLBACK_IMAGE], a["id"])
            self.ops.clear_hold.assert_called_once()
            self.ops.prune_old.assert_called_once()
            with self.assertRaisesRegex(DeploymentError, "different compatible pinned image"):
                bg.rollback(self.ops)

    def test_final_readiness_failure_preserves_existing_rollback(self):
        with patch.multiple(bg, memory_guard=MagicMock(), start=MagicMock(),
                            switch=MagicMock(), stop=MagicMock(), ready=MagicMock(return_value=False)):
            with self.assertRaises(DeploymentError):
                bg.handoff(self.ops, "blue", self.current, "green", self.candidate, True)
            self.ops.command.assert_not_called()
            self.ops.clear_hold.assert_not_called()
            self.ops.prune_old.assert_not_called()

    def test_pin_failure_keeps_hold_and_skips_prune(self):
        self.ops.command.side_effect = subprocess.CalledProcessError(1, "docker tag")
        with patch.multiple(bg, memory_guard=MagicMock(), start=MagicMock(),
                            switch=MagicMock(), stop=MagicMock(), ready=MagicMock(return_value=True)):
            with self.assertRaises(DeploymentError):
                bg.handoff(self.ops, "blue", self.current, "green", self.candidate, True)
            self.ops.clear_hold.assert_not_called()
            self.ops.prune_old.assert_not_called()

    def test_rollback_requires_a_pinned_image(self):
        self.ops.image.side_effect = subprocess.CalledProcessError(1, "docker image inspect")
        with patch.multiple(bg, inspect_active=MagicMock(return_value=("green", self.candidate)),
                            handoff=MagicMock()):
            with self.assertRaisesRegex(DeploymentError, "No successful blue-green rollback image"):
                bg.rollback(self.ops)
            self.ops.image.assert_called_once_with(bg.ROLLBACK_IMAGE)
            bg.handoff.assert_not_called()

    def test_unsupported_candidate_never_mutates_host(self):
        with self.assertRaises(DeploymentError):
            bg.handoff(self.ops, "blue", self.current, "green", self.candidate | {"leader": None}, True)
        self.ops.write_hold.assert_not_called()


if __name__ == "__main__":
    unittest.main()
