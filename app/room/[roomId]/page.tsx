import { Suspense } from "react";
import RoomClient from "@/components/RoomClient";

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] items-center justify-center bg-[#F5F3ED] text-sm font-medium text-[#565E58]">
          Loading NOVA translation room...
        </div>
      }
    >
      <RoomClient />
    </Suspense>
  );
}
