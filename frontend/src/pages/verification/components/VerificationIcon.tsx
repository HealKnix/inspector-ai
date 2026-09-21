import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  CheckIcon,
  Download01Icon,
  File02Icon,
  FitToScreenIcon,
  FullScreenIcon,
  MoreHorizontalIcon,
  Search01Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

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

const icons: Record<VerificationIconName, IconSvgElement> = {
  "arrow-right": ArrowRight02Icon,
  check: CheckIcon,
  "chevron-down": ArrowDown01Icon,
  "chevron-left": ArrowLeft01Icon,
  "chevron-right": ArrowRight01Icon,
  "chevron-up": ArrowUp01Icon,
  close: Cancel01Icon,
  document: File02Icon,
  download: Download01Icon,
  expand: FullScreenIcon,
  fit: FitToScreenIcon,
  more: MoreHorizontalIcon,
  search: Search01Icon,
  sort: ArrowUpDownIcon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
};

export function VerificationIcon({
  className,
  name,
  strokeWidth = 1.8,
}: VerificationIconProps) {
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
