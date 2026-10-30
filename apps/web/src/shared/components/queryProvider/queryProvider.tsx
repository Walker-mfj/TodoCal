"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: false,
            refetchInterval: () =>
              typeof document !== "undefined" &&
              document.visibilityState === "visible"
                ? 15_000
                : false,
          },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
