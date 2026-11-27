import { Suspense } from "react";
import CameraTranslateClient from "@/components/CameraTranslateClient";

export default function CameraTranslatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#F5F3ED] text-sm font-medium text-[#565E58]">
          Loading NOVA Camera Translate...
        </div>
      }
    >
      <CameraTranslateClient />
    </Suspense>
  );
}
