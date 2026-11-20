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
            self.ops.clear_hold.assert_called_once()

    def test_unready_candidate_never_switches(self):
        with patch.multiple(bg, memory_guard=MagicMock(), start=MagicMock(side_effect=DeploymentError("unready")),
                            switch=MagicMock(), stop=MagicMock(), ready=MagicMock()):
            with self.assertRaises(DeploymentError):
                bg.handoff(self.ops, "blue", self.current, "green", self.candidate, True)
            bg.switch.assert_not_called()
            bg.stop.assert_called_once_with(self.ops, "green")
            self.ops.clear_hold.assert_not_called()

    def test_ambiguous_reload_keeps_both_slots_and_hold(self):
        with patch.multiple(bg, memory_guard=MagicMock(), start=MagicMock(),
                            switch=MagicMock(side_effect=DeploymentError("drain")),
                            stop=MagicMock(), ready=MagicMock()):
            with self.assertRaises(DeploymentError):
                bg.handoff(self.ops, "blue", self.current, "green", self.candidate, True)
            bg.stop.assert_not_called()
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
            with self.assertRaisesRegex(DeploymentError, "compatible slot image"):
                bg.rollback(self.ops)
            bg.handoff.assert_not_called()

    def test_unsupported_candidate_never_mutates_host(self):
        with self.assertRaises(DeploymentError):
            bg.handoff(self.ops, "blue", self.current, "green", self.candidate | {"leader": None}, True)
        self.ops.write_hold.assert_not_called()


if __name__ == "__main__":
    unittest.main()
