export function HeroGlobeIllustration() {
  return (
    <div
      className="relative h-28 w-36 sm:h-32 sm:w-44 shrink-0 select-none"
      aria-hidden="true"
    >
      {/* Subtle dotted world-map backdrop */}
      <svg
        viewBox="0 0 180 120"
        fill="none"
        className="absolute -top-4 -right-3 h-32 w-48 opacity-45"
      >
        <g fill="#A8BDA9">
          <circle cx="26" cy="28" r="2" />
          <circle cx="34" cy="24" r="2" />
          <circle cx="42" cy="30" r="2" />
          <circle cx="38" cy="38" r="2" />
          <circle cx="48" cy="46" r="2" />
          <circle cx="56" cy="54" r="2" />
          <circle cx="76" cy="22" r="2" />
          <circle cx="84" cy="20" r="2" />
          <circle cx="92" cy="26" r="2" />
          <circle cx="86" cy="34" r="2" />
          <circle cx="94" cy="42" r="2" />
          <circle cx="88" cy="52" r="2" />
          <circle cx="96" cy="60" r="2" />
          <circle cx="114" cy="28" r="2" />
          <circle cx="122" cy="24" r="2" />
          <circle cx="132" cy="30" r="2" />
          <circle cx="140" cy="36" r="2" />
          <circle cx="126" cy="42" r="2" />
          <circle cx="138" cy="52" r="2" />
          <circle cx="148" cy="68" r="2" />
        </g>
      </svg>

      {/* Forest-green globe orb with gentle orbital communication arcs */}
      <svg
        viewBox="0 0 140 120"
        fill="none"
        className="relative z-10 h-full w-full drop-shadow-[0_12px_20px_rgba(33,69,54,0.18)]"
      >
        <defs>
          <radialGradient id="nova-globe-grad" cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#5D876E" />
            <stop offset="65%" stopColor="#315F4A" />
            <stop offset="100%" stopColor="#214536" />
          </radialGradient>
        </defs>

        {/* Soft reflection */}
        <ellipse
          cx="74"
          cy="108"
          rx="32"
          ry="6"
          fill="#A8BDA9"
          fillOpacity="0.35"
        />

        {/* Globe sphere */}
        <circle cx="74" cy="58" r="38" fill="url(#nova-globe-grad)" />

        {/* Stylized natural continent silhouettes */}
        <path
          d="M52 38c6-4 14-3 17 2 3 5-2 10-7 13-5 3-3 10 2 14 4 3 1 11-5 12-6 1-11-6-11-14 0-9-2-23 4-27Z"
          fill="#DCE8DD"
          fillOpacity="0.82"
        />
        <path
          d="M78 30c9-2 20 2 24 10 3 6-2 13-9 14-5 1-8 5-5 10 3 5 9 7 7 14-2 6-10 9-15 5-6-5-7-14-4-22 3-8-6-29 2-31Z"
          fill="#DCE8DD"
          fillOpacity="0.72"
        />

        {/* Communication orbital rings */}
        <ellipse
          cx="74"
          cy="58"
          rx="52"
          ry="17"
          transform="rotate(-22 74 58)"
          stroke="#E8D8BF"
          strokeWidth="2.2"
          strokeOpacity="0.92"
        />
        <ellipse
          cx="74"
          cy="58"
          rx="48"
          ry="15"
          transform="rotate(18 74 58)"
          stroke="#FFFFFF"
          strokeWidth="1.6"
          strokeOpacity="0.65"
        />
      </svg>
    </div>
  );
}

export function EarbudsIllustration() {
  return (
    <div
      className="relative flex h-28 w-28 sm:h-32 sm:w-32 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#DCE8DD]/75 via-[#F5F3ED] to-[#A8BDA9]/35 p-2 overflow-hidden"
      aria-hidden="true"
    >
      <svg viewBox="0 0 120 120" fill="none" className="h-full w-full">
        {/* Concentric subtle sage soundwave arcs */}
        <path
          d="M20 42a46 46 0 0 0 0 36"
          stroke="#A8BDA9"
          strokeWidth="2"
          strokeLinecap="round"
          strokeOpacity="0.6"
        />
        <path
          d="M29 48a34 34 0 0 0 0 24"
          stroke="#315F4A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeOpacity="0.45"
        />
        <path
          d="M100 42a46 46 0 0 1 0 36"
          stroke="#A8BDA9"
          strokeWidth="2"
          strokeLinecap="round"
          strokeOpacity="0.6"
        />
        <path
          d="M91 48a34 34 0 0 1 0 24"
          stroke="#315F4A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeOpacity="0.45"
        />

        {/* Charging case */}
        <rect
          x="31"
          y="60"
          width="58"
          height="42"
          rx="16"
          fill="#FFFFFF"
          stroke="#E6E5DE"
          strokeWidth="2"
        />
        <path d="M31 74h58" stroke="#E6E5DE" strokeWidth="1.5" />
        <circle cx="60" cy="83" r="2.2" fill="#4C8062" />

        {/* Left earbud */}
        <rect
          x="41"
          y="34"
          width="11"
          height="30"
          rx="5.5"
          transform="rotate(-12 41 34)"
          fill="#FFFFFF"
          stroke="#D7D6CE"
          strokeWidth="1.8"
        />
        <circle cx="44" cy="36" r="8.5" fill="#FFFFFF" stroke="#D7D6CE" strokeWidth="1.8" />
        <circle cx="43" cy="36" r="3" fill="#315F4A" />

        {/* Right earbud */}
        <rect
          x="68"
          y="32"
          width="11"
          height="30"
          rx="5.5"
          transform="rotate(12 68 32)"
          fill="#FFFFFF"
          stroke="#D7D6CE"
          strokeWidth="1.8"
        />
        <circle cx="76" cy="36" r="8.5" fill="#FFFFFF" stroke="#D7D6CE" strokeWidth="1.8" />
        <circle cx="77" cy="36" r="3" fill="#315F4A" />
      </svg>
    </div>
  );
}

export function TwoPhonesIllustration() {
  return (
    <div
      className="relative flex h-28 w-28 sm:h-32 sm:w-32 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E8D8BF]/70 via-[#F5F3ED] to-[#C58B62]/20 p-2 overflow-hidden"
      aria-hidden="true"
    >
      <svg viewBox="0 0 120 120" fill="none" className="h-full w-full">
        {/* Orbital sand connection ring */}
        <ellipse
          cx="60"
          cy="64"
          rx="48"
          ry="16"
          transform="rotate(-10 60 64)"
          stroke="#C58B62"
          strokeWidth="2"
          strokeOpacity="0.65"
        />

        {/* Left phone (NOVA leaf) */}
        <g transform="rotate(-12 40 60)">
          <rect
            x="22"
            y="24"
            width="36"
            height="68"
            rx="8"
            fill="#242A26"
            stroke="#315F4A"
            strokeWidth="1.5"
          />
          <rect x="25" y="28" width="30" height="60" rx="5.5" fill="#214536" />
          <path
            d="M33 65c1-8 6-14 14-15-1 8-6 14-14 15Z"
            fill="#DCE8DD"
          />
          <path
            d="M33.5 64.5c4-4 8.5-8 13-13"
            stroke="#214536"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </g>

        {/* Right phone (QR code icon) */}
        <g transform="rotate(12 80 60)">
          <rect
            x="62"
            y="24"
            width="36"
            height="68"
            rx="8"
            fill="#242A26"
            stroke="#315F4A"
            strokeWidth="1.5"
          />
          <rect x="65" y="28" width="30" height="60" rx="5.5" fill="#1C2420" />
          {/* Minimal QR grid */}
          <rect x="72" y="48" width="7" height="7" rx="1.2" stroke="#E8D8BF" strokeWidth="1.6" />
          <rect x="82" y="48" width="7" height="7" rx="1.2" stroke="#E8D8BF" strokeWidth="1.6" />
          <rect x="72" y="58" width="7" height="7" rx="1.2" stroke="#E8D8BF" strokeWidth="1.6" />
          <rect x="82" y="58" width="3" height="3" fill="#E8D8BF" />
          <rect x="86" y="62" width="3" height="3" fill="#E8D8BF" />
        </g>
      </svg>
    </div>
  );
}
