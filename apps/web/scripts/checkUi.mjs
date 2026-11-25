import ts from "typescript";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const fixed = /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\s*\(/i;
const loading =
  /^(?:(?:Loading|Fetching)(?:$|\s|…|\.)|Opening your workspace|Checking (?:this device|affected occurrences))/;
const namedColors = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(
    " ",
  ),
);
function namedColor(value) {
  return (
    value.replace(/var\([^)]*\)|url\([^)]*\)/g, "").match(/[a-z]+/gi) || []
  ).some((word) => namedColors.has(word.toLowerCase()));
}
export function checkSource(file, source) {
  const errors = [];
  const report = (rule, position) =>
    errors.push(
      `${file}:${source.slice(0, position).split("\n").length}: ${rule}: use global colors (UI001), Skeleton (UI002), LoadingIndicator (UI003) LoadingPage (UI004), or owned assets/Lucide (UI005)`,
    );
  for (const match of source.matchAll(/data\s*:\s*image\//gi))
    report("UI005", match.index);
  if (/(?:^|\/)loading\.tsx$/.test(file) && !/<LoadingPage\b/.test(source))
    report("UI004", 0);
  if (file.endsWith(".css")) {
    if (
      !/shared\/components\/(?:loadingIndicator|skeleton)\//.test(file) &&
      /@keyframes\s+[\w-]*(?:spin|rotate|shimmer|skeleton)/i.test(source)
    )
      report("UI003", 0);
    for (const match of source.matchAll(/[^{};]+:\s*([^{};]+)[;}]/g))
      if (fixed.test(match[1]) || namedColor(match[1]))
        report("UI001", match.index);
  } else {
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function literalAttribute(element, name, value) {
      return element.attributes.properties.some(
        (a) =>
          ts.isJsxAttribute(a) &&
          a.name.getText(ast) === name &&
          a.initializer &&
          ts.isStringLiteral(a.initializer) &&
          a.initializer.text === value,
      );
    }
    function hidden(node) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (!ts.isJsxElement(parent)) continue;
        const element = parent.openingElement;
        if (
          element.attributes.properties.some(
            (a) =>
              ts.isJsxAttribute(a) &&
              a.name.getText(ast) === "className" &&
              a.initializer &&
              ts.isStringLiteral(a.initializer) &&
              a.initializer.text.split(/\s+/).includes("sr-only"),
          )
        )
          return true;
        const owner = parent.parent;
        if (
          literalAttribute(element, "data-button-reserve", "true") &&
          literalAttribute(element, "aria-hidden", "true") &&
          owner &&
          ts.isJsxElement(owner) &&
          owner.openingElement.tagName.getText(ast) === "button" &&
          literalAttribute(owner.openingElement, "data-pending-control", "true")
        )
          return true;
      }
      return false;
    }
    function nonLiteral(expression) {
      if (!expression) return false;
      if (
        ts.isParenthesizedExpression(expression) ||
        ts.isPrefixUnaryExpression(expression)
      )
        return nonLiteral(expression.expression || expression.operand);
      return !ts.isLiteralExpression(expression);
    }
    function dynamicSvg(node) {
      let dynamic = false;
      function inspect(child) {
        if (
          child !== node &&
          (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child))
        ) {
          const element = ts.isJsxElement(child) ? child.openingElement : child;
          for (const attr of element.attributes.properties) {
            if (!ts.isJsxAttribute(attr) || !attr.initializer) continue;
            const name = attr.name.getText(ast);
            if (
              /^(d|points|x|y|x1|x2|y1|y2|cx|cy|r|rx|ry|strokeDasharray|strokeDashoffset)$/.test(
                name,
              ) &&
              ts.isJsxExpression(attr.initializer) &&
              nonLiteral(attr.initializer.expression)
            )
              dynamic = true;
            if (
              name === "style" &&
              ts.isJsxExpression(attr.initializer) &&
              attr.initializer.expression &&
              ts.isObjectLiteralExpression(attr.initializer.expression) &&
              attr.initializer.expression.properties.some(
                (prop) =>
                  ts.isPropertyAssignment(prop) &&
                  /^(strokeDashoffset|strokeDasharray)$/.test(
                    prop.name.getText(ast),
                  ) &&
                  nonLiteral(prop.initializer),
              )
            )
              dynamic = true;
          }
        }
        ts.forEachChild(child, inspect);
      }
      inspect(node);
      return dynamic;
    }
    function visit(node) {
      if (
        ts.isJsxElement(node) &&
        node.openingElement.tagName.getText(ast) === "svg" &&
        !dynamicSvg(node)
      )
        report("UI005", node.pos);
      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(ast) === "svg"
      )
        report("UI005", node.pos);

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
            namedColor(node.text)))
      )
        report("UI001", node.pos);
      if (
        !hidden(node) &&
        loading.test(node.text?.trim() || "") &&
        (ts.isJsxText(node) ||
          (string &&
            (ts.isJsxExpression(node.parent) ||
              ts.isConditionalExpression(node.parent) ||
              ts.isBinaryExpression(node.parent) ||
              attribute === "fallback")))
      )
        report("UI002", node.pos);
      if (
        !hidden(node) &&
        /^(?:Saving|Restoring|Enabling|Please wait|Confirming completion)(?:$|[\s….])/.test(
          node.text?.trim() || "",
        ) &&
        (ts.isJsxText(node) || string)
      ) {
        let parent = node.parent;
        while (parent && !ts.isJsxElement(parent) && !ts.isJsxFragment(parent))
          parent = parent.parent;
        if (
          parent &&
          !/<LoadingIndicator\b/.test(parent.getText(ast)) &&
          attribute !== "aria-label"
        )
          report("UI003", node.pos);
      }
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
