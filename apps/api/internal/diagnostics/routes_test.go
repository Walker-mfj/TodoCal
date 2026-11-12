package diagnostics

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"testing"
)

// Inspect the real router registrations: adding a route without updating the
// privacy allowlist must fail CI, rather than silently producing route=unknown.
func TestRegisteredRoutesHaveDiagnosticTemplates(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "../router/router.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		name, ok := call.Fun.(*ast.Ident)
		if !ok || name.Name != "handle" {
			return true
		}
		if len(call.Args) != 2 {
			t.Fatal("unexpected route registration")
		}
		literal, ok := call.Args[0].(*ast.BasicLit)
		if !ok {
			t.Fatal("route must be a constant template")
		}
		pattern, err := strconv.Unquote(literal.Value)
		if err != nil {
			t.Fatal(err)
		}
		found[pattern] = true
		if _, ok := routes[pattern]; !ok {
			t.Errorf("missing diagnostic template: %s", pattern)
		}
		return true
	})
	if len(found) == 0 {
		t.Fatal("no router registrations found")
	}
	for pattern := range routes {
		if !found[pattern] {
			t.Errorf("unregistered diagnostic template: %s", pattern)
		}
	}
}
