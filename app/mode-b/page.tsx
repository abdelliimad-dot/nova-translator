import { Suspense } from "react";
import ModeBCreateClient from "@/components/ModeBCreateClient";

export default function ModeBPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#F5F3ED] text-sm font-medium text-[#565E58]">
          Loading NOVA Two-Phone room setup...
        </div>
      }
    >
      <ModeBCreateClient />
    </Suspense>
  );
}
