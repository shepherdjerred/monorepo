import type { ReactNode } from "react";

export function Container({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl sm:px-6 lg:px-8">{children}</div>;
}
