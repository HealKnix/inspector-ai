export type UploadIconName =
  | "plus"
  | "arrow-left"
  | "download"
  | "check"
  | "chevron-right"
  | "file"
  | "folder"
  | "info"
  | "layers"
  | "more"
  | "play"
  | "sparkles"
  | "template"
  | "trash"
  | "upload"
  | "warning"
  | "pdf"
  | "docx"
  | "xml";

interface UploadIconProps {
  className?: string;
  name: UploadIconName;
}

function IconPaths({ name }: Pick<UploadIconProps, "name">) {
  switch (name) {
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "arrow-left":
      return <path d="M20 12H4m6-6-6 6 6 6" />;
    case "download":
      return <path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" />;
    case "check":
      return <path d="m5 12 4 4L19 6" />;
    case "chevron-right":
      return <path d="m9 18 6-6-6-6" />;
    case "file":
      return (
        <>
          <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v5h5M9 13h6M9 17h4" />
        </>
      );
    case "folder":
      return (
        <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" />
      );
    case "info":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6M12 7h.01" />
        </>
      );
    case "layers":
      return (
        <>
          <path d="m12 3 8 4-8 4-8-4z" />
          <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
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
    case "play":
      return <path d="m9 6 9 6-9 6z" />;
    case "sparkles":
      return (
        <>
          <path d="M12 2.5c.5 3.5 2 5 5.5 5.5-3.5.5-5 2-5.5 5.5C11.5 10 10 8.5 6.5 8 10 7.5 11.5 6 12 2.5Z" />
          <path d="M18.5 13c.3 2 1.2 2.9 3 3.2-1.8.3-2.7 1.2-3 3.3-.3-2.1-1.2-3-3-3.3 1.8-.3 2.7-1.2 3-3.2ZM6 14.5c.3 1.7 1 2.4 2.5 2.7-1.5.3-2.2 1-2.5 2.8-.3-1.8-1-2.5-2.5-2.8 1.5-.3 2.2-1 2.5-2.7Z" />
        </>
      );
    case "template":
      return (
        <>
          <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v5h5M9 12h6M9 16h6" />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
        </>
      );
    case "upload":
      return (
        <>
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
          <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </>
      );
    case "warning":
      return (
        <>
          <path d="M10.3 4.2 2.8 18a2 2 0 0 0 1.8 3h14.8a2 2 0 0 0 1.8-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </>
      );
    case "pdf":
      return (
        <path
          d="M13 9h5.5L13 3.5V9M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.853.853 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69l.48-.31m3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z"
          fill="#ef5350"
        />
      );
    case "docx":
      return (
        <path
          d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5L13 3.5M7 13l1.5 7h2l1.5-3 1.5 3h2l1.5-7h1v-2h-4v2h1l-.9 4.2L13 15h-2l-1.1 2.2L9 13h1v-2H6v2h1z"
          fill="#01579b"
        />
      );
    case "xml":
      return (
        <path
          d="M13 9h5.5L13 3.5V9M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41-3.74 3.74m11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41 3.74-3.74z"
          fill="#8bc34a"
        />
      );
  }
}

export function UploadIcon({ className, name }: UploadIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="24"
    >
      <IconPaths name={name} />
    </svg>
  );
}
