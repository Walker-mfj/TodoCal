import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // Benchmark two parallel Playwright workers on CI; keep local runs unchanged.
  workers: process.env.CI ? 2 : 1,
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chrome", use: { browserName: "chromium", channel: "chrome" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  reporter: "list",
});
