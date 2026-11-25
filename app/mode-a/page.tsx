import { Suspense } from "react";
import ModeAClient from "@/components/ModeAClient";

export default function ModeAPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-[#F5F3ED] text-sm font-medium text-[#777F79]">
          Loading NOVA Face-to-Face translator...
        </div>
      }
    >
      <ModeAClient />
    </Suspense>
  );
}
