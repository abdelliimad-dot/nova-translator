import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NOVA — Real-Time AI Translation",
    short_name: "NOVA",
    description:
      "Understand each other. Real-time AI voice translation for shared earbuds and two-phone QR rooms.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5F3ED",
    theme_color: "#315F4A",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
