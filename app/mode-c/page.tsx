import { Suspense } from "react";
import ModeCClient from "@/components/ModeCClient";

export default function ModeCPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-[#F5F3ED] text-sm font-medium text-[#565E58]">
          Loading NOVA Phone Speaker translator...
        </div>
      }
    >
      <ModeCClient />
    </Suspense>
  );
}
