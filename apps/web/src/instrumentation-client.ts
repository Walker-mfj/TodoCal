import * as Sentry from "@sentry/browser";
import { reportBrowserError } from "./shared/utils/monitoring";

if (process.env.NEXT_PUBLIC_MONITORING_ENABLED === "true") {
  Sentry.init({
    release: process.env.NEXT_PUBLIC_RELEASE,
    // The SDK only constructs events. beforeSend relays scrubbed JSON to our API;
    // this placeholder never receives traffic and exposes no provider credential.
    dsn: "https://public@monitoring.invalid/1",
    defaultIntegrations: false,
    integrations: [
      Sentry.globalHandlersIntegration(),
      Sentry.browserApiErrorsIntegration(),
    ],
    transport: () => ({ send: async () => ({}), flush: async () => true }),
    sendClientReports: false,
    beforeSend(event) {
      reportBrowserError(event);
      return null;
    },
  });
}
