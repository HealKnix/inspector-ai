export type DashboardIconName =
  | "menu"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "plus"
  | "lightning"
  | "search"
  | "calendar"
  | "more"
  | "folder"
  | "chat"
  | "pulse"
  | "help"
  | "settings"
  | "share"
  | "close"
  | "expand"
  | "history"
  | "copy"
  | "globe"
  | "upload"
  | "refresh"
  | "arrow-up"
  | "sparkles"
  | "sources"
  | "auto"
  | "thumbs-up"
  | "thumbs-down"
  | "volume"
  | "grid"
  | "user";

interface DashboardIconProps {
  name: DashboardIconName;
  className?: string;
  strokeWidth?: number;
}

function IconPaths({ name }: Pick<DashboardIconProps, "name">) {
  switch (name) {
    case "menu":
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case "chevron-left":
      return <path d="m15 18-6-6 6-6" />;
    case "chevron-right":
      return <path d="m9 18 6-6-6-6" />;
    case "chevron-down":
      return <path d="m6 9 6 6 6-6" />;
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "lightning":
      return <path d="m13 2-8 12h7l-1 8 8-12h-7z" />;
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M8 3v4M16 3v4M3.5 9.5h17M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
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
    case "folder":
      return (
        <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" />
      );
    case "chat":
      return (
        <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 9 9 0 0 1-3.5-.7L4 20l1.5-4A7.5 7.5 0 1 1 20 11.5Z" />
      );
    case "pulse":
      return <path d="M3 12h4l2-6 4 12 2.5-8 1.5 2h4" />;
    case "help":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.7 9a2.4 2.4 0 1 1 3.6 2.1c-.8.5-1.3 1-1.3 2M12 17h.01" />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
        </>
      );
    case "share":
      return (
        <>
          <circle cx="18" cy="5" r="2.5" />
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="19" r="2.5" />
          <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
        </>
      );
    case "close":
      return <path d="M6 6l12 12M18 6 6 18" />;
    case "expand":
      return <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />;
    case "history":
      return (
        <>
          <path d="M4 8V4m0 0h4M4.7 4.7A9 9 0 1 1 3 14" />
          <path d="M12 7v5l3 2" />
        </>
      );
    case "copy":
      return (
        <>
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      );
    case "globe":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z" />
        </>
      );
    case "upload":
      return (
        <>
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
          <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </>
      );
    case "refresh":
      return (
        <>
          <path d="M20 6v5h-5M4 18v-5h5" />
          <path d="M18.5 9A7.5 7.5 0 0 0 5.9 6.4L4 11M5.5 15A7.5 7.5 0 0 0 18.1 17.6L20 13" />
        </>
      );
    case "arrow-up":
      return <path d="M12 19V5m0 0L6.5 10.5M12 5l5.5 5.5" />;
    case "sparkles":
      return (
        <>
          <path d="M12 2.5c.5 3.5 2 5 5.5 5.5-3.5.5-5 2-5.5 5.5C11.5 10 10 8.5 6.5 8 10 7.5 11.5 6 12 2.5Z" />
          <path d="M18.5 13c.3 2 1.2 2.9 3 3.2-1.8.3-2.7 1.2-3 3.3-.3-2.1-1.2-3-3-3.3 1.8-.3 2.7-1.2 3-3.2ZM6 14.5c.3 1.7 1 2.4 2.5 2.7-1.5.3-2.2 1-2.5 2.8-.3-1.8-1-2.5-2.5-2.8 1.5-.3 2.2-1 2.5-2.7Z" />
        </>
      );
    case "sources":
      return (
        <>
          <path d="m12 3 8 4-8 4-8-4z" />
          <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
        </>
      );
    case "auto":
      return (
        <>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M18 9h4M2 15h4M18 15h4M9.5 12h5" />
        </>
      );
    case "thumbs-up":
      return (
        <>
          <path d="M7.5 10 11 3.5a2 2 0 0 1 2 2V9h4.7a2 2 0 0 1 1.9 2.6l-2 6A2 2 0 0 1 15.7 19H7.5Z" />
          <path d="M3.5 10h4v9h-4z" />
        </>
      );
    case "thumbs-down":
      return (
        <>
          <path d="M7.5 14 11 20.5a2 2 0 0 0 2-2V15h4.7a2 2 0 0 0 1.9-2.6l-2-6A2 2 0 0 0 15.7 5H7.5Z" />
          <path d="M3.5 5h4v9h-4z" />
        </>
      );
    case "volume":
      return (
        <>
          <path d="M5 10H2.5v4H5l4 3.5v-11zM13 9a4 4 0 0 1 0 6M16 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      );
    case "grid":
      return (
        <>
          <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
          <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
          <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
          <rect x="14" y="14" width="6.5" height="6.5" rx="1" />
        </>
      );
    case "user":
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </>
      );
  }
}

export function DashboardIcon({
  name,
  className,
  strokeWidth = 1.8,
}: DashboardIconProps) {
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
