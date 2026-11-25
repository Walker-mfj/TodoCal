# TodoCal assets

- `brand/todocalLogo.png`: supplied full logo, used by the light login screen.
- `brand/calendarCheckmark.png`: supplied calendar icon, used by the sidebar and dark login screen. The sidebar wordmark is theme-aware text with a blue gradient accent.
- `icons/androidChrome192x192.png` and `icons/androidChrome512x512.png`: installation icons referenced by `src/app/manifest.ts`.

Components and the manifest import these files directly. Next.js emits their public URLs during the build; these imported files do not need to be placed in `public/`.

The browser favicon (`src/app/favicon.ico`) and Apple icon (`src/app/apple-icon.png`) stay in the App Router directory so Next.js generates their metadata links automatically.

The favicon contains 16×16, 32×32, and 48×48 images exported from `icons/androidChrome512x512.png`.

## Asset ownership (UI005)

See [UI005 — Asset ownership](../../../docs/architecture/qualityChecks.md#ui005--asset-ownership).

- `brand/`: static logos and brand art; intrinsic palettes are allowed.
- `icons/`: custom static icons; prefer lucide-react when an equivalent exists. Theme-aware icons use currentColor in inline React SVG, or static SVG masks with a visible color from a global token. Standalone SVG images do not inherit the page's CSS variables.
- `illustrations/`: static illustrative images; intrinsic palettes are allowed.
- Use build-managed imports in components and manifest, and relative asset references in CSS. Do not embed authored SVG data URIs or Base64 images.
- Dynamic SVG whose internal geometry/progress/interaction is driven by component props/state belongs to the owning React component, not this directory. Size, color, visibility and CSS rotation alone do not make a glyph dynamic. Use Lucide for ordinary icons and the shared LoadingIndicator glyph; do not duplicate a library icon in assets.

## Stable public URLs

`apps/web/public/` is only for files that require a stable root-relative URL independently of build-generated imports. Currently `public/sw.js` is served as `/sw.js` for browser service worker registration and scope; preserve this contract. Examples of future justified uses are an externally referenced fixed image URL or a runtime-selected static filename that cannot use an import mapping. Do not copy existing imported PWA icons to public; the manifest already emits valid URLs. Keep framework metadata files in `src/app/`. Public files are directly accessible and must not contain secrets or private user data. Document any new stable path and its consumers/cache policy here; do not duplicate assets.

References: [Next.js public folder](https://nextjs.org/docs/app/api-reference/file-conventions/public-folder), [App Router icon metadata](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons).

## UI005 migration

- `icons/chevronDown.svg` is a fixed monochrome stencil. Its black stroke defines mask opacity only; shared select wrappers supply the visible semantic color and preserve pointer/keyboard handling. Forced-colors uses ButtonText. The CSS bundler emits the asset URL for normal and static builds.
- LoadingIndicator uses Lucide LoaderCircle; there is no custom spinner SVG asset or copied geometry.
- TimerClock remains inline because its ring stroke offset changes with progress. No image files were added to public; existing service worker and metadata URLs are unchanged.
