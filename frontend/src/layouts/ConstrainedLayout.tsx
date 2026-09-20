import { ReactNode } from "react";

export function ConstrainedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto min-h-full max-w-[1680px] space-y-6 px-4 pt-5 pb-10 min-[1400px]:px-8 sm:px-6 sm:pt-7">
        {children}
      </div>
    </div>
  );
}
