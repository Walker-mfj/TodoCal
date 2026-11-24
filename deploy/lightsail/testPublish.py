"""Exercise the publish workflow fast path without Docker or GitHub."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name("publish.sh")
DIGEST = "sha256:"+"e"*64


@unittest.skipUnless(shutil.which("git"), "requires git")
class PublishTests(unittest.TestCase):
    def test_unchanged_api_tree_redelivers_same_digest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True).strip()
            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            (root/"apps/api").mkdir(parents=True)
            (root/"apps/api/main.go").write_text("old API")
            git("add", ".")
            git("commit", "-qm", "API")
            tree = git("rev-parse", "HEAD:apps/api")
            (root/"README.md").write_text("docs only")
            git("add", ".")
            git("commit", "-qm", "docs")
            sha = git("rev-parse", "HEAD")
            fp = subprocess.check_output(["git", "ls-tree", "-r", sha, "--",
                "apps/api/internal/database/migrations", "apps/api/internal/database/migrate.go",
                "apps/api/start.sh", "apps/api/go.mod", "apps/api/go.sum"], cwd=root)
            import hashlib
            bins = root/"bin"
            bins.mkdir()
            gh = bins/"gh"
            gh.write_text('#!/bin/sh\nprintf "%s\\n" "$TESTED_SHA"\n')
            gh.chmod(0o755)
            docker = bins/"docker"
            docker.write_text("""#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
if args[0] in ('login','logout','pull'): pass
elif args[:2]==['image','inspect']:
    query=args[3]
    if 'api-tree' in query: print(os.environ['TREE'])
    elif 'migrations' in query: print(os.environ['FP'])
    elif 'RepoDigests' in query: print('ghcr.io/walker-mfj/todocal-api@'+os.environ['DIGEST'])
    else: raise SystemExit(99)
else: raise SystemExit(99)
""")
            docker.chmod(0o755)
            out = root/"output"
            env = os.environ | {"PATH":str(bins)+os.pathsep+os.environ["PATH"],
                     "TESTED_SHA":sha, "GITHUB_REPOSITORY":"Walker-mfj/TodoCal",
                     "GITHUB_ACTOR":"stub", "GH_TOKEN":"stub", "GHCR_TOKEN":"stub",
                     "GITHUB_OUTPUT":str(out), "TREE":tree,
                     "FP":hashlib.sha256(fp).hexdigest(), "DIGEST":DIGEST}
            subprocess.run(["bash",str(SCRIPT)], cwd=root, env=env, check=True)
            self.assertEqual(out.read_text(),"digest="+DIGEST+"\n")



class ReleaseWorkflowTests(unittest.TestCase):
    """Guard the production workflow wiring and exercise the actual publish step."""

    ROOT = SCRIPT.parents[2]

    def workflows(self):
        folder = self.ROOT / ".github/workflows"
        return ((folder / "deployBackend.yml").read_text(),
                (folder / "deployFrontend.yml").read_text())

    def test_frontend_requires_successful_ci_and_confirmed_delivery(self):
        backend, frontend = self.workflows()
        self.assertIn("github.event.workflow_run.conclusion == 'success'", backend)
        self.assertIn("github.event.workflow_run.head_branch == 'main'", backend)
        self.assertIn("ready: ${{ steps.delivery.outcome == 'success' }}", backend)
        self.assertIn("id: delivery\n        if: vars.LIGHTSAIL_EVENT_DEPLOY != 'false' && steps.image.outputs.digest != ''", backend)
        self.assertIn("needs: publish", backend)
        self.assertIn("if: needs.publish.outputs.ready == 'true' && needs.publish.outputs.digest != ''", backend)
        self.assertIn("tested_sha: ${{ github.event.workflow_run.head_sha }}", backend)
        self.assertIn("on:\n  workflow_call:", frontend)
        self.assertNotIn("  workflow_dispatch:", frontend)
        self.assertNotIn("  push:", frontend)
        self.assertIn("ref: ${{ inputs.tested_sha }}", frontend)
        self.assertIn("group: todocal-backend-production\n  cancel-in-progress: false", backend)

    def test_frontend_publish_checks_readiness_and_current_main(self):
        _, frontend = self.workflows()
        # Exercise the exact shell block used by Actions, including pipefail.
        step = frontend.split("      - name: Publish frontend\n", 1)[1]
        shell = step.split("        run: |\n", 1)[1].split("        env:\n", 1)[0]
        shell = "\n".join(line[10:] for line in shell.splitlines())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bins = root / "bin"
            bins.mkdir()
            commands = {
                "curl": '#!/bin/sh\nprintf "%s\\n" "$READY_STATUS"\nexit "$CURL_EXIT"\n',
                "jq": '#!/bin/sh\nread -r status\n[ "$status" = ready ]\n',
                "gh": '#!/bin/sh\nprintf "%s\\n" "$CURRENT_SHA"\nexit "$GH_EXIT"\n',
                "npx": '#!/bin/sh\ntouch "$PUBLISH_MARKER"\n',
            }
            for name, source in commands.items():
                path = bins / name
                path.write_text(source)
                path.chmod(0o755)
            marker = root / "published"
            output = root / "output"
            base = os.environ | {
                "PATH": str(bins) + os.pathsep + os.environ["PATH"],
                "TESTED_SHA": "a" * 40, "CURRENT_SHA": "a" * 40,
                "READY_STATUS": "ready", "CURL_EXIT": "0", "GH_EXIT": "0",
                "GITHUB_REPOSITORY": "Walker-mfj/TodoCal",
                "GITHUB_OUTPUT": str(output), "PUBLISH_MARKER": str(marker),
            }
            for changes, success, published in [
                ({}, True, True),
                ({"CURRENT_SHA": "b" * 40}, True, False),
                ({"READY_STATUS": "not-ready"}, False, False),
                ({"CURL_EXIT": "1"}, False, False),
                ({"GH_EXIT": "1"}, False, False),
            ]:
                with self.subTest(changes=changes):
                    marker.unlink(missing_ok=True)
                    output.unlink(missing_ok=True)
                    result = subprocess.run(["bash", "-eo", "pipefail", "-c", shell],
                                            env=base | changes, capture_output=True)
                    self.assertEqual(result.returncode == 0, success, result.stderr)
                    self.assertEqual(marker.exists(), published)
                    self.assertEqual(output.exists(), published)
                    if published:
                        self.assertEqual(output.read_text(), "published=true\n")


if __name__ == "__main__":
    unittest.main()
