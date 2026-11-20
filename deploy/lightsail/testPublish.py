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


if __name__ == "__main__":
    unittest.main()
