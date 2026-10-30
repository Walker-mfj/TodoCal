import type { Metadata } from "next";
import { Providers } from "./providers";
import "../shared/styles/tokens.css";
import "../shared/styles/reset.css";
import "../shared/styles/globals.css";
export const metadata: Metadata = {
  title: "TodoCal — Tasks & Calendar",
  description:
    "A clear plan, a little breathing room. Your personal calendar and daily progress.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
