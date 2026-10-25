import type { MetadataRoute } from "next";
import androidIcon192 from "../../assets/icons/android-chrome-192x192.png";
import androidIcon512 from "../../assets/icons/android-chrome-512x512.png";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TodoCal",
    short_name: "TodoCal",
    description: "Tasks and calendar in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#f7f8fa",
    icons: [
      { src: androidIcon192.src, sizes: "192x192", type: "image/png" },
      { src: androidIcon512.src, sizes: "512x512", type: "image/png" },
    ],
  };
}
