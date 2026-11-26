"use client";

import { useEffect } from "react";
import { useNovaSettings } from "@/lib/settingsStore";

/**
 * Keeps `<html lang dir>` synchronized with the user's selected UI locale
 * so scrollbars, form pickers, and browser navigation reflect EN (LTR) / AR (RTL).
 */
export default function HtmlLocaleSync() {
  const { uiLocale } = useNovaSettings();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = uiLocale === "ar" ? "ar" : "en";
    document.documentElement.dir = uiLocale === "ar" ? "rtl" : "ltr";
  }, [uiLocale]);

  return null;
}
