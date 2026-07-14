export default function AuthIllustration() {
  return (
    <svg viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="200" cy="200" r="170" fill="white" fillOpacity="0.06" />
      <circle cx="330" cy="80" r="46" fill="white" fillOpacity="0.08" />
      <circle cx="60" cy="320" r="34" fill="white" fillOpacity="0.08" />

      {/* phone / post card */}
      <rect x="120" y="70" width="160" height="230" rx="20" fill="white" fillOpacity="0.12" stroke="white" strokeOpacity="0.35" strokeWidth="2" />
      <rect x="140" y="96" width="120" height="70" rx="10" fill="white" fillOpacity="0.18" />
      <rect x="140" y="178" width="90" height="10" rx="5" fill="white" fillOpacity="0.4" />
      <rect x="140" y="196" width="120" height="8" rx="4" fill="white" fillOpacity="0.22" />
      <rect x="140" y="212" width="70" height="8" rx="4" fill="white" fillOpacity="0.22" />

      {/* comment bubble with keyword highlight */}
      <g transform="translate(20 130)">
        <path d="M0 16C0 7.163 7.163 0 16 0H84C92.837 0 100 7.163 100 16V56C100 64.837 92.837 72 84 72H26L8 88V72H16C7.163 72 0 64.837 0 56V16Z" fill="white" fillOpacity="0.9" />
        <rect x="16" y="20" width="68" height="8" rx="4" fill="#7c3aed" fillOpacity="0.35" />
        <rect x="16" y="36" width="44" height="8" rx="4" fill="#7c3aed" fillOpacity="0.55" />
      </g>

      {/* auto-reply arrow */}
      <path d="M118 158C104 158 96 168 96 180" stroke="white" strokeOpacity="0.6" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 6" />
      <path d="M92 176L96 184L102 178" stroke="white" strokeOpacity="0.6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* DM / send bubble bottom right */}
      <g transform="translate(280 230)">
        <rect x="0" y="0" width="92" height="60" rx="16" fill="white" fillOpacity="0.9" />
        <path d="M8 60L8 76L26 60H8Z" fill="white" fillOpacity="0.9" />
        <path d="M18 30L74 30" stroke="#7c3aed" strokeOpacity="0.55" strokeWidth="6" strokeLinecap="round" />
        <path d="M18 42L52 42" stroke="#7c3aed" strokeOpacity="0.35" strokeWidth="6" strokeLinecap="round" />
      </g>

      {/* calendar chip top right */}
      <g transform="translate(300 40)">
        <rect x="0" y="0" width="52" height="52" rx="12" fill="white" fillOpacity="0.14" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
        <rect x="10" y="14" width="32" height="4" rx="2" fill="white" fillOpacity="0.6" />
        <rect x="10" y="24" width="20" height="4" rx="2" fill="white" fillOpacity="0.4" />
        <rect x="10" y="32" width="26" height="4" rx="2" fill="white" fillOpacity="0.4" />
      </g>

      {/* mini analytics bars bottom left */}
      <g transform="translate(50 300)">
        <rect x="0" y="20" width="10" height="24" rx="3" fill="white" fillOpacity="0.35" />
        <rect x="16" y="8" width="10" height="36" rx="3" fill="white" fillOpacity="0.55" />
        <rect x="32" y="0" width="10" height="44" rx="3" fill="white" fillOpacity="0.75" />
      </g>
    </svg>
  )
}
