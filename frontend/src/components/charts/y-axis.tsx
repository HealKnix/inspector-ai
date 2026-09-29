"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useChart, useChartStable } from "./chart-context";
import { intFmt } from "./chart-formatters";
import { resolveYAxisTickCount } from "./y-axis-ticks";

export interface YAxisProps {
  /** Number of y tick labels. Default: 5 */
  numTicks?: number;
}

export function YAxis(props: YAxisProps) {
  const { containerRef } = useChartStable();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }

  return <YAxisInner {...props} container={container} />;
}

const YAxisInner = memo(function YAxisInner({
  numTicks,
  container,
}: YAxisProps & { container: HTMLElement }) {
  const { yScale, margin } = useChart();

  const ticks = useMemo(
    () => yScale.ticks(resolveYAxisTickCount(numTicks)),
    [yScale, numTicks],
  );

  return createPortal(
    <div className="pointer-events-none absolute inset-0">
      {ticks.map((tick) => (
        <span
          className="text-chart-label absolute text-xs whitespace-nowrap"
          key={tick}
          style={{
            left: 0,
            width: margin.left - 8,
            top: margin.top + (yScale(tick) ?? 0),
            transform: "translateY(-50%)",
            textAlign: "right",
          }}
        >
          {intFmt(tick)}
        </span>
      ))}
    </div>,
    container,
  );
});

export default YAxis;
