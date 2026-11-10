// TypeScript resolves both relative and tsconfig path-aliased module specifiers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = fileURLToPath(new URL("../", import.meta.url));
export function checkArchitecture(project = web) {
  const configFile = ts.readConfigFile(
    path.join(project, "tsconfig.json"),
    ts.sys.readFile,
  );
  if (configFile.error) throw new Error("Cannot read tsconfig.json");
  const { options } = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    project,
  );
  const root = path.join(project, "src");
  const files = ts.sys.readDirectory(root, [
    ".ts",
    ".tsx",
    ".mts",
    ".js",
    ".jsx",
  ]);
  const problems = new Set();
  const edges = new Map();
  for (const file of files) {
    const from = path.relative(root, file).split(path.sep);
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      false,
    );
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specifier = node.moduleSpecifier;
      else if (ts.isExternalModuleReference(node)) specifier = node.expression;
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        specifier = node.argument.literal;
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      )
        specifier = node.arguments[0];
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const resolved = ts.resolveModuleName(
          specifier.text,
          file,
          options,
          ts.sys,
        ).resolvedModule;
        // TypeScript leaves side-effect and CSS Module imports unresolved; they
        // still cross an ownership boundary when the stylesheet lives in another feature.
        const spec = specifier.text;
        const asset = spec.startsWith(".")
          ? path.resolve(path.dirname(file), spec)
          : spec.startsWith("@/")
            ? path.join(root, spec.slice(2))
            : null;
        const dest =
          resolved?.resolvedFileName ||
          (asset && fs.existsSync(asset) && fs.statSync(asset).isFile()
            ? asset
            : null);
        if (dest) {
          const target = path.relative(root, dest).split(path.sep);
          const crossFeature =
            from[0] === "features" &&
            target[0] === "features" &&
            from[1] !== target[1];
          if (
            (from[0] === "shared" &&
              ["features", "home", "app"].includes(target[0])) ||
            (from[0] === "features" && ["home", "app"].includes(target[0])) ||
            (from[0] === "home" && target[0] === "app") ||
            (crossFeature &&
              !(target.length === 3 && /^index\.[cm]?[jt]sx?$/.test(target[2])))
          ) {
            problems.add(from.join("/") + " imports " + target.join("/"));
          }
          if (crossFeature) {
            if (!edges.has(from[1])) edges.set(from[1], new Set());
            edges.get(from[1]).add(target[1]);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const visited = new Set();
  function trace(feature, stack) {
    if (stack.includes(feature)) {
      problems.add(
        "Feature dependency cycle: " +
          [...stack.slice(stack.indexOf(feature)), feature].join(" -> "),
      );
      return;
    }
    if (visited.has(feature)) return;
    for (const next of edges.get(feature) || [])
      trace(next, [...stack, feature]);
    visited.add(feature);
  }
  for (const feature of edges.keys()) trace(feature, []);
  return [...problems];
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const problems = checkArchitecture();
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
