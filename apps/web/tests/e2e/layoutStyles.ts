import { readFileSync } from "node:fs";
import { createServer } from "vite";

/** Load the actual components through Vite so Node can handle CSS Modules.
 * Identity names match the stylesheet fixtures; production keeps hashed names. */
export async function layoutComponent<T>(path: string): Promise<T> {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, ws: false },
    css: { modules: { generateScopedName: "[local]" } },
  });
  try {
    return (await server.ssrLoadModule(path)) as T;
  } finally {
    await server.close();
  }
}

/** Static markup retains the semantic hooks; remove only CSS Modules scoping syntax.
 * Include the same foundation and component styles as the application. */
export function layoutStyles(...modules: string[]) {
  return [
    "src/shared/styles/tokens.css",
    "src/shared/styles/reset.css",
    "src/shared/styles/globals.css",
    "src/shared/styles/formControls.module.css",
    "src/shared/styles/uiPrimitives.module.css",
    ...modules,
  ]
    .map((file) =>
      readFileSync(file, "utf8").replace(/:global\(([^)]+)\)/g, "$1"),
    )
    .join("\n");
}
