import tempfile
import unittest
from pathlib import Path
from checkGoArchitecture import violations


class GoArchitectureTest(unittest.TestCase):
    def test_rejects_repository_importing_service(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "go.mod").write_text("module check.example\n\ngo 1.22\n")
            for layer in ("services", "repository"):
                directory = root / "internal" / layer
                directory.mkdir(parents=True)
                (directory / "package.go").write_text(f"package {layer}\n")
            self.assertEqual(list(violations(root)), [])
            (root / "internal/repository/package.go").write_text(
                'package repository\nimport _ "check.example/internal/services"\n'
            )
            self.assertEqual(list(violations(root)), [
                "check.example/internal/repository imports check.example/internal/services"
            ])


if __name__ == "__main__":
    unittest.main()
