import { ReactNode } from "react";

export function Container({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-4xl sm:px-6 lg:px-8">{children}</div>;
}
