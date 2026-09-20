import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(milliseconds: number) {
  if (milliseconds < 1) return "<1 мс";
  return `${Math.round(milliseconds)} мс`;
}
