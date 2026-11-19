"""Exercise publish.sh's no-build recovery path with real Git and mocked GitHub."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name("publish.sh")


@unittest.skipUnless(shutil.which("git") and shutil.which("jq"), "requires git and jq")
class PublishTests(unittest.TestCase):
    def test_unchanged_api_redelivers_previously_published_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=root, text=True).strip()

            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            (root / "apps/api").mkdir(parents=True)
            (root / "apps/api/main.go").write_text("old API")
            git("add", ".")
            git("commit", "-qm", "published API")
            tag = "api-" + git("rev-parse", "HEAD")
            git("tag", tag)
            (root / "README.md").write_text("frontend-only change")
            git("add", ".")
            git("commit", "-qm", "docs change")
            sha = git("rev-parse", "HEAD")
            bin_dir = root / "bin"
            bin_dir.mkdir()
            gh = bin_dir / "gh"
            gh.write_text("""#!/usr/bin/env python3
import json, os, sys
path = sys.argv[2]
if path.endswith('/git/ref/heads/main'):
    print(os.environ['TESTED_SHA'])
elif path.endswith('/releases/latest'):
    print(os.environ['OLD_RELEASE'])
elif '/releases?' in path:
    print(json.dumps([[{'tag_name': os.environ['OLD_RELEASE'], 'draft': False, 'prerelease': False}]]))
else:
    raise SystemExit('Unexpected GitHub API call')
""")
            gh.chmod(0o755)
            docker = bin_dir / "docker"
            docker.write_text("#!/bin/sh\nexit 99\n")
            docker.chmod(0o755)
            output = root / "output"
            env = os.environ | {"PATH": str(bin_dir)+os.pathsep+os.environ["PATH"],
                                "TESTED_SHA": sha, "GITHUB_SHA": "f"*40,
                                "GITHUB_REPOSITORY": "example/TodoCal", "GH_TOKEN": "stub",
                                "GITHUB_EVENT_NAME": "workflow_run", "GITHUB_OUTPUT": str(output),
                                "OLD_RELEASE": tag}
            subprocess.run(["bash", str(SCRIPT)], cwd=root, env=env, check=True)
            self.assertEqual(output.read_text(), "tag="+tag+"\n")


if __name__ == "__main__":
    unittest.main()
