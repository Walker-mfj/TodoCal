"use client";
import { LoadingRegion } from "../../../../shared/components/loadingRegion/loadingRegion";

import { Skeleton } from "../../../../shared/components/skeleton/skeleton";
import dynamic from "next/dynamic";
export const Calendar = dynamic(() => import("./calendar"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", minHeight: 480, padding: 16 }}>
      <LoadingRegion label="Loading calendar…">
        <Skeleton width="100%" height={40} />
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <span key={row} style={{ display: "flex", gap: 8, marginBlock: 12 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <Skeleton key={day} width="calc((100% - 48px) / 7)" height={60} />
            ))}
          </span>
        ))}
      </LoadingRegion>
    </div>
  ),
});
