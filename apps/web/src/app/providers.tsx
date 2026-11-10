"use client";
import type { ReactNode } from "react";
import { QueryProvider } from "../shared/components/queryProvider/queryProvider";
import { AppDialogProvider } from "../shared/components/appDialog/appDialog";
import { SessionProvider } from "../features/auth";
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AppDialogProvider>
        <SessionProvider>{children}</SessionProvider>
      </AppDialogProvider>
    </QueryProvider>
  );
}
