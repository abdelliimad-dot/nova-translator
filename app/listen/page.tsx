import { Suspense } from "react";
import LiveListenClient from "@/components/LiveListenClient";

export default function ListenPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-[#F5F3ED] text-sm font-medium text-[#565E58]">
          Loading NOVA Live Listen...
        </div>
      }
    >
      <LiveListenClient />
    </Suspense>
  );
}
