import { Outlet } from "react-router";
import {
  ContractMismatchBanner,
  VersionFooter,
} from "#src/components/version-info.tsx";

/**
 * Top-level chrome shared by every route (login included): the contract
 * mismatch banner above the routed content and the build-identity footer below
 * it. Mirrors the old `App` wrapper — the routed page renders through the
 * {@link Outlet}.
 */
export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <ContractMismatchBanner />
      <div className="flex-1">
        <Outlet />
      </div>
      <VersionFooter />
    </div>
  );
}
