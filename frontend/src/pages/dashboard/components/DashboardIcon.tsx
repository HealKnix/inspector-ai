import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp02Icon,
  Calendar01Icon,
  Cancel01Icon,
  Chat01Icon,
  Copy01Icon,
  CpuIcon,
  File02Icon,
  Folder01Icon,
  FullScreenIcon,
  Globe02Icon,
  GridViewIcon,
  HelpCircleIcon,
  HistoryIcon,
  Layers01Icon,
  Menu01Icon,
  MoreHorizontalIcon,
  Pulse01Icon,
  RefreshIcon,
  Search01Icon,
  Settings02Icon,
  Share08Icon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Upload04Icon,
  UserIcon,
  VolumeHighIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

export type DashboardIconName =
  | "menu"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "plus"
  | "lightning"
  | "search"
  | "calendar"
  | "file"
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

const icons: Record<DashboardIconName, IconSvgElement> = {
  menu: Menu01Icon,
  "chevron-left": ArrowLeft01Icon,
  "chevron-right": ArrowRight01Icon,
  "chevron-down": ArrowDown01Icon,
  plus: Add01Icon,
  lightning: ZapIcon,
  search: Search01Icon,
  calendar: Calendar01Icon,
  file: File02Icon,
  more: MoreHorizontalIcon,
  folder: Folder01Icon,
  chat: Chat01Icon,
  pulse: Pulse01Icon,
  help: HelpCircleIcon,
  settings: Settings02Icon,
  share: Share08Icon,
  close: Cancel01Icon,
  expand: FullScreenIcon,
  history: HistoryIcon,
  copy: Copy01Icon,
  globe: Globe02Icon,
  upload: Upload04Icon,
  refresh: RefreshIcon,
  "arrow-up": ArrowUp02Icon,
  sparkles: SparklesIcon,
  sources: Layers01Icon,
  auto: CpuIcon,
  "thumbs-up": ThumbsUpIcon,
  "thumbs-down": ThumbsDownIcon,
  volume: VolumeHighIcon,
  grid: GridViewIcon,
  user: UserIcon,
};

export function DashboardIcon({
  name,
  className,
  strokeWidth = 1.8,
}: DashboardIconProps) {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className={className}
      focusable="false"
      icon={icons[name]}
      size={20}
      strokeWidth={strokeWidth}
    />
  );
}
