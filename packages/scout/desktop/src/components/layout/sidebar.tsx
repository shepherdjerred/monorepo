import { Gamepad2, Server, Activity, Bug, Swords } from "lucide-react";
import { cn } from "@shepherdjerred/scout-desktop/lib/utils";

type SidebarProps = {
  lcuConnected: boolean;
  backendConnected: boolean;
  isMonitoring: boolean;
  activeSection: "league" | "backend" | "monitor";
  onSectionChange: (section: "league" | "backend" | "monitor") => void;
  showDebug: boolean;
  onToggleDebug: () => void;
};

type NavItemProps = {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  status: "connected" | "disconnected" | "active" | "idle";
  onClick: () => void;
  disabled?: boolean;
};

function NavItem({ icon, label, active, status, onClick, disabled }: NavItemProps) {
  const isOn = status === "connected" || status === "active";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-4 py-3",
        "text-left text-sm font-medium transition-all duration-200",
        active ? "bg-discord-blurple/15 text-white" : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn("transition-colors", active ? "text-discord-blurple" : "text-gray-500 group-hover:text-gray-400")}
      >
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <span className={cn("h-2 w-2 rounded-full transition-colors", isOn ? "bg-discord-green" : "bg-gray-600")} />
    </button>
  );
}

export function Sidebar({
  lcuConnected,
  backendConnected,
  isMonitoring,
  activeSection,
  onSectionChange,
  showDebug,
  onToggleDebug,
}: SidebarProps) {
  const canMonitor = lcuConnected && backendConnected;

  return (
    <aside className="flex h-full w-60 flex-col border-r border-gray-800 bg-gray-900/50">
      {/* Logo */}
      <div className="flex items-center gap-3 border-b border-gray-800 px-5 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-discord-blurple to-lol-gold shadow-lg">
          <Swords className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-100">Scout</h1>
          <p className="text-xs text-gray-500">for League of Legends</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        <NavItem
          icon={<Gamepad2 className="h-5 w-5" />}
          label="League Client"
          active={activeSection === "league"}
          status={lcuConnected ? "connected" : "disconnected"}
          onClick={() => {
            onSectionChange("league");
          }}
        />
        <NavItem
          icon={<Server className="h-5 w-5" />}
          label="Backend"
          active={activeSection === "backend"}
          status={backendConnected ? "connected" : "disconnected"}
          onClick={() => {
            onSectionChange("backend");
          }}
        />
        <NavItem
          icon={<Activity className="h-5 w-5" />}
          label="Monitoring"
          active={activeSection === "monitor"}
          status={isMonitoring ? "active" : "idle"}
          onClick={() => {
            onSectionChange("monitor");
          }}
          disabled={!canMonitor}
        />
      </nav>

      {/* Status Summary */}
      <div className="border-t border-gray-800 p-5">
        <div className="mb-4 text-xs font-medium uppercase tracking-wider text-gray-500">Status</div>
        <div className="space-y-3">
          <StatusRow label="League" connected={lcuConnected} />
          <StatusRow label="Backend" connected={backendConnected} />
        </div>
      </div>

      {/* Footer Actions */}
      <div className="border-t border-gray-800 p-4">
        <button
          onClick={onToggleDebug}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors",
            showDebug ? "bg-gray-800 text-gray-200" : "text-gray-500 hover:bg-gray-800/50 hover:text-gray-300",
          )}
        >
          <Bug className="h-4 w-4" />
          <span>Debug Panel</span>
        </button>
      </div>
    </aside>
  );
}

function StatusRow({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", connected ? "bg-discord-green" : "bg-gray-600")} />
        <span className={connected ? "text-discord-green" : "text-gray-500"}>{connected ? "On" : "Off"}</span>
      </div>
    </div>
  );
}
