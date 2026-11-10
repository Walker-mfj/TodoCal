import tempfile
import unittest
from pathlib import Path
from checkGoArchitecture import violations


class GoArchitectureTest(unittest.TestCase):
    def check_import(self, source, target, forbidden):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "go.mod").write_text("module check.example\n\ngo 1.22\n")
            for layer in (source, target):
                directory = root / "internal" / layer
                directory.mkdir(parents=True)
                (directory / "package.go").write_text(f"package {layer}\n")
            self.assertEqual(list(violations(root)), [])
            (root / "internal" / source / "package.go").write_text(
                f'package {source}\nimport _ "check.example/internal/{target}"\n'
            )
            expected = [f"check.example/internal/{source} imports check.example/internal/{target}"] if forbidden else []
            self.assertEqual(list(violations(root)), expected)

    def test_rejects_forbidden_imports(self):
        # Keep expectations independent of FORBIDDEN: deleting a production rule
        # must fail a test rather than silently remove its fixture too.
        edges = {
            "controllers": ("repository", "workers"),
            "services": ("controllers", "router"),
            "repository": ("controllers", "router", "services"),
            "models": ("controllers", "router", "services", "repository", "database"),
            "workers": ("controllers", "router"),
        }
        for source, targets in edges.items():
            for target in targets:
                with self.subTest(source=source, target=target):
                    self.check_import(source, target, forbidden=True)

    def test_accepts_supported_layer_dependencies(self):
        for source, target in (
            ("controllers", "router"),
            ("controllers", "services"),
            ("services", "repository"),
            ("repository", "database"),
            ("workers", "services"),
        ):
            with self.subTest(source=source, target=target):
                self.check_import(source, target, forbidden=False)


if __name__ == "__main__":
    unittest.main()
