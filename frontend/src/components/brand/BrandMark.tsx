interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        height="38"
        rx="12"
        stroke="currentColor"
        strokeWidth="2"
        width="38"
        x="1"
        y="1"
      />
      <path
        d="M12 14.5h11M12 20h16M12 25.5h9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="m24.5 26 2.6 2.6 5.4-6.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}
