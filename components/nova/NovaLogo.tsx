interface NovaLogoProps {
  size?: number;
  className?: string;
}

/**
 * Custom NOVA leaf-and-connection geometric mark.
 * Designed in forest green (#315F4A) & sage (#A8BDA9) to scale cleanly
 * from 24px header badges up to 512px PWA app icons.
 */
export default function NovaLogo({ size = 38, className = "" }: NovaLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Subtle sage backing leaf */}
      <path
        d="M11 33C10.5 20.5 19.5 10.5 34.5 9.5C35.2 21.5 28 31.5 15.5 33.8"
        fill="#A8BDA9"
        fillOpacity="0.48"
      />
      {/* Primary forest-green leaf silhouette */}
      <path
        d="M12.5 35.5C13.5 23.5 22 14.5 36.5 13C35 26 26.5 34.5 12.5 35.5Z"
        fill="#315F4A"
      />
      {/* Connection bridge vein */}
      <path
        d="M13 35C19.5 28.5 26.8 22.2 35.6 13.8"
        stroke="#F5F3ED"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Warm sand companion arc */}
      <path
        d="M22.5 32.5C27.2 32.2 32.2 29.8 35.8 25.5"
        stroke="#C58B62"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
