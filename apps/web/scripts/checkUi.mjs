import ts from "typescript";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const fixed = /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\s*\(/i;
const loading =
  /^(?:Loading(?:\s|…|\.)|Opening your workspace|Checking (?:this device|affected occurrences))/;
export function checkSource(file, source) {
  const errors = [];
  const report = (rule, position) =>
    errors.push(
      `${file}:${source.slice(0, position).split("\n").length}: ${rule}: use global colors or shared Skeleton`,
    );
  if (file.endsWith(".css")) {
    for (const match of source.matchAll(/[^{};]+:\s*([^{};]+)[;}]/g))
      if (
        fixed.test(match[1]) ||
        /^(?:white|black|red|blue|gray)$/i.test(match[1].trim())
      )
        report("UI001", match.index);
  } else {
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function hidden(node) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          ts.isJsxElement(parent) &&
          parent.openingElement.attributes.properties.some(
            (a) =>
              ts.isJsxAttribute(a) &&
              a.name.getText(ast) === "className" &&
              a.initializer &&
              /sr-only/.test(a.initializer.getText(ast)),
          )
        )
          return true;
      }
      return false;
    }
    function visit(node) {
      const string =
        ts.isStringLiteralLike(node) ||
        ts.isNoSubstitutionTemplateLiteral(node);
      const attribute =
        node.parent && ts.isJsxAttribute(node.parent)
          ? node.parent.name.getText(ast)
          : "";
      const property =
        node.parent && ts.isPropertyAssignment(node.parent)
          ? node.parent.name.getText(ast)
          : attribute;
      if (
        string &&
        !["href", "id", "aria-label", "className"].includes(attribute) &&
        (fixed.test(node.text) ||
          (/color|fill|stroke|background/i.test(property) &&
            /^(red|white|black|blue|gray|green)$/i.test(node.text)))
      )
        report("UI001", node.pos);
      if (
        !hidden(node) &&
        loading.test(node.text?.trim() || "") &&
        (ts.isJsxText(node) ||
          (string &&
            (ts.isJsxExpression(node.parent) ||
              ts.isConditionalExpression(node.parent) ||
              attribute === "fallback")))
      )
        report("UI002", node.pos);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return errors;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  const errors = files
    .filter(
      (f) =>
        /\.(css|tsx?|mjs)$/.test(f) &&
        !/\.test\.|\.generated\./.test(f) &&
        ![
          "src/shared/styles/tokens.css",
          "src/shared/constants/colorValues.ts",
        ].includes(f),
    )
    .flatMap((f) => checkSource(f, readFileSync(f, "utf8")));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}
