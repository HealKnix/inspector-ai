/** Bounded base-ten arithmetic. No binary float participates in decisions. */
export interface Decimal {
  coefficient: bigint;
  scale: number;
}
const MAX_INPUT_DIGITS = 80;
const MAX_INPUT_SCALE = 30;
const MAX_WORK_DIGITS = 240;
const MAX_WORK_SCALE = 90;
function power(n: number): bigint {
  if (!Number.isInteger(n) || n < 0 || n > MAX_WORK_SCALE)
    throw new Error("decimal_scale_limit");
  return 10n ** BigInt(n);
}
function make(coefficient: bigint, scale: number): Decimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_WORK_SCALE)
    throw new Error("decimal_scale_limit");
  while (scale && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  if (coefficient.toString().replace("-", "").length > MAX_WORK_DIGITS)
    throw new Error("decimal_digit_limit");
  return { coefficient, scale: coefficient === 0n ? 0 : scale };
}
export function decimal(value: string): Decimal {
  if (
    typeof value !== "string" ||
    value.length > MAX_INPUT_DIGITS + 3 ||
    !/^[+-]?\d+(?:\.\d+)?$/.test(value)
  )
    throw new Error("decimal_invalid");
  const [whole, fraction = ""] = value.split(".");
  if (
    value.replace(/[-+.]/g, "").length > MAX_INPUT_DIGITS ||
    fraction.length > MAX_INPUT_SCALE
  )
    throw new Error("decimal_input_limit");
  return make(BigInt(whole! + fraction), fraction.length);
}
export function decimalText(value: Decimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, "0");
  const text = value.scale
    ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`
    : digits;
  return `${negative ? "-" : ""}${text}`;
}
export function decimalCompare(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const left = a.coefficient * power(scale - a.scale),
    right = b.coefficient * power(scale - b.scale);
  return left < right ? -1 : left > right ? 1 : 0;
}
export function decimalAdd(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return make(
    a.coefficient * power(scale - a.scale) +
      b.coefficient * power(scale - b.scale),
    scale,
  );
}
export function decimalSubtract(a: Decimal, b: Decimal): Decimal {
  return decimalAdd(a, { coefficient: -b.coefficient, scale: b.scale });
}
export function decimalMultiply(a: Decimal, b: Decimal): Decimal {
  return make(a.coefficient * b.coefficient, a.scale + b.scale);
}
export function decimalShift(a: Decimal, exponent: number): Decimal {
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30)
    throw new Error("decimal_exponent_limit");
  return exponent <= a.scale
    ? make(a.coefficient, a.scale - exponent)
    : make(a.coefficient * power(exponent - a.scale), 0);
}
export function decimalAbs(a: Decimal): Decimal {
  return {
    ...a,
    coefficient: a.coefficient < 0n ? -a.coefficient : a.coefficient,
  };
}
export function decimalMin(a: Decimal, b: Decimal): Decimal {
  return decimalCompare(a, b) <= 0 ? a : b;
}
export function decimalMax(a: Decimal, b: Decimal): Decimal {
  return decimalCompare(a, b) >= 0 ? a : b;
}
export type RoundingMode = "half_up" | "half_even" | "toward_zero";
export function decimalRound(
  a: Decimal,
  scale: number,
  mode: RoundingMode,
): Decimal {
  if (!Number.isInteger(scale) || scale < 0 || scale > 30)
    throw new Error("rounding_scale_limit");
  if (a.scale <= scale) return a;
  const divisor = power(a.scale - scale),
    sign = a.coefficient < 0n ? -1n : 1n;
  const magnitude = a.coefficient * sign;
  let quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  if (
    mode !== "toward_zero" &&
    (2n * remainder > divisor ||
      (2n * remainder === divisor &&
        (mode === "half_up" || quotient % 2n !== 0n)))
  )
    quotient++;
  return make(quotient * sign, scale);
}
/** Exponents are accepted only for a finite JSON number's shortest spelling. */
export function decimalLiteral(value: string | number): Decimal {
  if (typeof value === "string") return decimal(value);
  if (!Number.isFinite(value)) throw new Error("decimal_invalid");
  const text = String(value),
    parts = /^([+-]?\d+(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(text);
  return parts
    ? decimalShift(decimal(parts[1]!), Number(parts[2]))
    : decimal(text);
}
/** Locale input retains original bytes elsewhere; ambiguous separators fail. */
export function normalizeDecimalInput(raw: string): string | null {
  if (raw.length > 256) return null;
  const text = raw.trim().replace(/^−/, "-");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/.test(text))
    return null;
  try {
    return decimalText(
      decimal(text.replace(/[ \u00a0\u202f]/g, "").replace(",", ".")),
    );
  } catch {
    return null;
  }
}
