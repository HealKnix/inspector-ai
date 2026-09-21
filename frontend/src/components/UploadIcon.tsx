import {
  Add01Icon,
  Alert02Icon,
  ArrowDownRight01Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  CheckIcon,
  Delete02Icon,
  Doc01Icon,
  Download01Icon,
  Edit02Icon,
  EyeIcon,
  File02Icon,
  FitToScreenIcon,
  Folder01Icon,
  FullScreenIcon,
  InformationCircleIcon,
  Layers01Icon,
  LayoutTemplateIcon,
  MoreVerticalIcon,
  Pdf01Icon,
  PlayIcon,
  Share01Icon,
  SparklesIcon,
  Upload04Icon,
  UserIcon,
  Xml01Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export type UploadIconName =
  | "plus"
  | "arrow-left"
  | "download"
  | "edit"
  | "eye"
  | "check"
  | "chevron-left"
  | "chevron-right"
  | "close"
  | "expand"
  | "file"
  | "fit"
  | "folder"
  | "info"
  | "layers"
  | "more"
  | "play"
  | "sparkles"
  | "template"
  | "trash"
  | "trend-down"
  | "trend-up"
  | "upload"
  | "user"
  | "warning"
  | "share"
  | "zoom-in"
  | "zoom-out"
  | "pdf"
  | "docx"
  | "xml";

interface UploadIconProps {
  className?: string;
  name: UploadIconName;
  strokeWidth?: number;
}

const icons: Record<UploadIconName, IconSvgElement> = {
  plus: Add01Icon,
  "arrow-left": ArrowLeft02Icon,
  "trend-down": ArrowDownRight01Icon,
  "trend-up": ArrowUpRight01Icon,
  download: Download01Icon,
  edit: Edit02Icon,
  eye: EyeIcon,
  check: CheckIcon,
  "chevron-left": ArrowLeft01Icon,
  "chevron-right": ArrowRight01Icon,
  close: Cancel01Icon,
  expand: FullScreenIcon,
  file: File02Icon,
  fit: FitToScreenIcon,
  folder: Folder01Icon,
  info: InformationCircleIcon,
  layers: Layers01Icon,
  more: MoreVerticalIcon,
  play: PlayIcon,
  sparkles: SparklesIcon,
  template: LayoutTemplateIcon,
  trash: Delete02Icon,
  upload: Upload04Icon,
  user: UserIcon,
  warning: Alert02Icon,
  share: Share01Icon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
  pdf: Pdf01Icon,
  docx: Doc01Icon,
  xml: Xml01Icon,
};

const iconColors: Partial<Record<UploadIconName, string>> = {
  pdf: "#ef5350",
  docx: "#01579b",
  xml: "#8bc34a",
};

export function UploadIcon({
  className,
  name,
  strokeWidth = 1.8,
}: UploadIconProps) {
  let iconPath = null;
  if (name === "pdf") {
    iconPath = (
      <path
        d="M13 9h5.5L13 3.5V9M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.853.853 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69l.48-.31m3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z"
        fill="#ef5350"
      />
    );
  } else if (name === "docx") {
    iconPath = (
      <path
        d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5L13 3.5M7 13l1.5 7h2l1.5-3 1.5 3h2l1.5-7h1v-2h-4v2h1l-.9 4.2L13 15h-2l-1.1 2.2L9 13h1v-2H6v2h1z"
        fill="#0355d3"
      />
    );
  } else if (name === "xml") {
    iconPath = (
      <path
        d="M13 9h5.5L13 3.5V9M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41-3.74 3.74m11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41 3.74-3.74z"
        fill="#8bc34a"
      />
    );
  }

  if (iconPath) {
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
        strokeWidth="0"
        viewBox="0 0 24 24"
        width="24"
      >
        {iconPath}
      </svg>
    );
  }

  return (
    <HugeiconsIcon
      aria-hidden="true"
      className={className}
      color={iconColors[name]}
      focusable="false"
      icon={icons[name]}
      size={24}
      strokeWidth={strokeWidth}
    />
  );
}
