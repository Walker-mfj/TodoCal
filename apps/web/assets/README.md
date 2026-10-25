# TodoCal assets

- `brand/todocal-logo.png`: supplied full logo, used by the light login screen.
- `brand/calendar-checkmark.png`: supplied calendar icon, used by the sidebar and dark login screen. The sidebar wordmark is theme-aware text with a blue gradient accent.
- `icons/android-chrome-192x192.png` and `icons/android-chrome-512x512.png`: installation icons referenced by `src/app/manifest.ts`.

Components and the manifest import these files directly. Next.js emits their public URLs during the build; a `public` folder is not needed.

The browser favicon (`src/app/favicon.ico`) and Apple icon (`src/app/apple-icon.png`) stay in the App Router directory so Next.js generates their metadata links automatically.

The favicon contains 16×16, 32×32, and 48×48 images exported from `icons/android-chrome-512x512.png`.
