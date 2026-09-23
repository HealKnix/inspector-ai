export const shortDateFmt = new Intl.DateTimeFormat("ru-RU", {
  month: "short",
  day: "numeric",
});

export const weekdayDateFmt = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export const hmsTimeFmt = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// `Intl.NumberFormat.prototype.format` is a bound getter — safe to extract.
export const intFmt = new Intl.NumberFormat("ru-RU").format;
