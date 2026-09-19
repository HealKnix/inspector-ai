export type VerificationIconName =
  | "arrow-right"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "close"
  | "document"
  | "download"
  | "expand"
  | "fit"
  | "more"
  | "search"
  | "sort"
  | "zoom-in"
  | "zoom-out";

interface VerificationIconProps {
  className?: string;
  name: VerificationIconName;
  strokeWidth?: number;
}

function IconPaths({ name }: Pick<VerificationIconProps, "name">) {
  switch (name) {
    case "arrow-right":
      return <path d="M4 12h16m0 0-6-6m6 6-6 6" />;
    case "check":
      return <path d="m5 12.5 4.2 4.2L19 7" />;
    case "chevron-down":
      return <path d="m7 9.5 5 5 5-5" />;
    case "chevron-left":
      return <path d="m14.5 6-6 6 6 6" />;
    case "chevron-right":
      return <path d="m9.5 6 6 6-6 6" />;
    case "chevron-up":
      return <path d="m7 14.5 5-5 5 5" />;
    case "close":
      return <path d="m6 6 12 12M18 6 6 18" />;
    case "document":
      return (
        <>
          <path d="M6 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z" />
          <path d="M13 3.5V9h5M8 13h8M8 16.5h6" />
        </>
      );
    case "download":
      return (
        <>
          <path d="M12 3.5v11m0 0 4-4m-4 4-4-4" />
          <path d="M5 18.5v2h14v-2" />
        </>
      );
    case "expand":
      return <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />;
    case "fit":
      return (
        <>
          <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
          <path d="M7.5 12h9" />
        </>
      );
    case "more":
      return (
        <>
          <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 4.5 4.5" />
        </>
      );
    case "sort":
      return (
        <>
          <path d="M8 5v14m0 0-3-3m3 3 3-3" />
          <path d="M16 19V5m0 0-3 3m3-3 3 3" />
        </>
      );
    case "zoom-in":
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M10.5 7.5v6M7.5 10.5h6m2 5 4.5 4.5" />
        </>
      );
    case "zoom-out":
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M7.5 10.5h6m2 5 4.5 4.5" />
        </>
      );
  }
}

export function VerificationIcon({
  className,
  name,
  strokeWidth = 1.8,
}: VerificationIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width="20"
    >
      <IconPaths name={name} />
    </svg>
  );
}
