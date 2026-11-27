interface LanguageFlagProps {
  code: string;
  size?: number;
  className?: string;
}

/**
 * Crisp circular SVG flag badges for consistent cross-platform rendering
 * across Android, iOS, and Windows (avoiding missing regional-indicator emojis).
 */
export default function LanguageFlag({
  code,
  size = 24,
  className = "",
}: LanguageFlagProps) {
  const norm = code.toLowerCase();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`shrink-0 rounded-full ring-1 ring-[#E6E5DE] ${className}`}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`flag-${norm}-${size}`}>
          <circle cx="12" cy="12" r="12" />
        </clipPath>
      </defs>
      <g clipPath={`url(#flag-${norm}-${size})`}>
        {(norm === "ar" || norm === "ar-dz") && (
          <>
            <rect x="0" y="0" width="12" height="24" fill="#1E6B47" />
            <rect x="12" y="0" width="12" height="24" fill="#FFFFFF" />
            <path
              d="M14.2 8.2a4.3 4.3 0 1 0 0 7.6 3.5 3.5 0 1 1 0-7.6Z"
              fill="#D22F3A"
            />
            <circle cx="13.9" cy="12" r="1.25" fill="#D22F3A" />
          </>
        )}

        {norm === "en" && (
          <>
            <rect width="24" height="24" fill="#1E3A8A" />
            <path d="M0 0L24 24M24 0L0 24" stroke="#FFFFFF" strokeWidth="4" />
            <path d="M0 0L24 24M24 0L0 24" stroke="#DC2626" strokeWidth="2" />
            <path d="M12 0V24M0 12H24" stroke="#FFFFFF" strokeWidth="6" />
            <path d="M12 0V24M0 12H24" stroke="#DC2626" strokeWidth="3.5" />
          </>
        )}

        {norm === "fr" && (
          <>
            <rect x="0" y="0" width="8" height="24" fill="#1D4ED8" />
            <rect x="8" y="0" width="8" height="24" fill="#FFFFFF" />
            <rect x="16" y="0" width="8" height="24" fill="#DC2626" />
          </>
        )}

        {norm === "tr" && (
          <>
            <rect width="24" height="24" fill="#DC2626" />
            <path
              d="M12.8 7.8a4.5 4.5 0 1 0 0 8.4 3.6 3.6 0 1 1 0-8.4Z"
              fill="#FFFFFF"
            />
            <circle cx="14.9" cy="12" r="1.35" fill="#FFFFFF" />
          </>
        )}

        {norm === "es" && (
          <>
            <rect x="0" y="0" width="24" height="6" fill="#C81E1E" />
            <rect x="0" y="6" width="24" height="12" fill="#FBBF24" />
            <rect x="0" y="18" width="24" height="6" fill="#C81E1E" />
          </>
        )}

        {norm === "de" && (
          <>
            <rect x="0" y="0" width="24" height="8" fill="#1F2937" />
            <rect x="0" y="8" width="24" height="8" fill="#DC2626" />
            <rect x="0" y="16" width="24" height="8" fill="#F59E0B" />
          </>
        )}

        {norm === "it" && (
          <>
            <rect x="0" y="0" width="8" height="24" fill="#15803D" />
            <rect x="8" y="0" width="8" height="24" fill="#FFFFFF" />
            <rect x="16" y="0" width="8" height="24" fill="#DC2626" />
          </>
        )}

        {norm === "pt" && (
          <>
            <rect x="0" y="0" width="10" height="24" fill="#15803D" />
            <rect x="10" y="0" width="14" height="24" fill="#DC2626" />
            <circle cx="10" cy="12" r="3.4" fill="#FBBF24" />
          </>
        )}

        {norm === "ja" && (
          <>
            <rect width="24" height="24" fill="#FFFFFF" />
            <circle cx="12" cy="12" r="5" fill="#DC2626" />
          </>
        )}

        {norm === "ko" && (
          <>
            <rect width="24" height="24" fill="#FFFFFF" />
            <path d="M12 7a5 5 0 0 1 0 10 5 5 0 0 1 0-10Z" fill="#DC2626" />
            <path d="M7 12a5 5 0 0 0 10 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 0-5 0Z" fill="#1D4ED8" />
          </>
        )}

        {norm === "zh" && (
          <>
            <rect width="24" height="24" fill="#DC2626" />
            <circle cx="7.5" cy="8" r="2.2" fill="#FBBF24" />
            <circle cx="12" cy="6" r="0.8" fill="#FBBF24" />
            <circle cx="13.2" cy="8.5" r="0.8" fill="#FBBF24" />
            <circle cx="12" cy="11" r="0.8" fill="#FBBF24" />
          </>
        )}

        {norm === "ms" && (
          <>
            <rect x="0" y="0" width="24" height="24" fill="#FFFFFF" />
            <rect x="0" y="0" width="24" height="3.5" fill="#DC2626" />
            <rect x="0" y="7" width="24" height="3.5" fill="#DC2626" />
            <rect x="0" y="14" width="24" height="3.5" fill="#DC2626" />
            <rect x="0" y="21" width="24" height="3" fill="#DC2626" />
            <rect x="0" y="0" width="13" height="13" fill="#1E3A8A" />
            <path
              d="M7.2 3.8a3.2 3.2 0 1 0 0 5.4 2.5 2.5 0 1 1 0-5.4Z"
              fill="#FBBF24"
            />
            <circle cx="8.8" cy="6.5" r="1.2" fill="#FBBF24" />
          </>
        )}

        {norm === "th" && (
          <>
            <rect x="0" y="0" width="24" height="4" fill="#DC2626" />
            <rect x="0" y="4" width="24" height="4" fill="#FFFFFF" />
            <rect x="0" y="8" width="24" height="8" fill="#1E3A8A" />
            <rect x="0" y="16" width="24" height="4" fill="#FFFFFF" />
            <rect x="0" y="20" width="24" height="4" fill="#DC2626" />
          </>
        )}

        {norm === "hi" && (
          <>
            <rect x="0" y="0" width="24" height="8" fill="#F97316" />
            <rect x="0" y="8" width="24" height="8" fill="#FFFFFF" />
            <rect x="0" y="16" width="24" height="8" fill="#15803D" />
            <circle cx="12" cy="12" r="2.2" fill="#1D4ED8" />
          </>
        )}

        {norm === "ur" && (
          <>
            <rect x="0" y="0" width="6" height="24" fill="#FFFFFF" />
            <rect x="6" y="0" width="18" height="24" fill="#14532D" />
            <path
              d="M16.2 8.2a4 4 0 1 0 0 7.6 3.2 3.2 0 1 1 0-7.6Z"
              fill="#FFFFFF"
            />
          </>
        )}

        {![
          "ar",
          "ar-dz",
          "en",
          "fr",
          "tr",
          "es",
          "de",
          "it",
          "pt",
          "ja",
          "ko",
          "zh",
          "ms",
          "th",
          "hi",
          "ur",
        ].includes(norm) && (
          <>
            <rect width="24" height="24" fill="#DCE8DD" />
            <circle cx="12" cy="12" r="6" fill="#315F4A" />
          </>
        )}
      </g>
    </svg>
  );
}
