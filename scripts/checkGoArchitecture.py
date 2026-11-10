"""Check direct imports using the same package graph as the Go compiler."""
import subprocess
from pathlib import Path

API = Path(__file__).resolve().parents[1] / "apps" / "api"
FORBIDDEN = {
    # Server.Handler composes the router with handlers through its interface.
    "controllers": {"repository", "workers"},
    "services": {"controllers", "router"},
    "repository": {"controllers", "router", "services"},
    "models": {"controllers", "router", "services", "repository", "database"},
    "workers": {"controllers", "router"},
}


def violations(project):
    module = subprocess.check_output(["go", "list", "-m"], cwd=project, text=True).strip()
    prefix = module + "/internal/"
    graph = subprocess.check_output(
        ["go", "list", "-f", '{{.ImportPath}} {{join .Imports " "}}', "./..."],
        cwd=project, text=True,
    )
    for row in graph.splitlines():
        name, *imports = row.split()
        if not name.startswith(prefix):
            continue
        layer = name[len(prefix):].split("/")[0]
        for dep in imports:
            if dep.startswith(prefix) and dep[len(prefix):].split("/")[0] in FORBIDDEN.get(layer, ()):
                yield f"{name} imports {dep}"


if __name__ == "__main__":
    errors = list(violations(API))
    if errors:
        raise SystemExit("\n".join(errors))
