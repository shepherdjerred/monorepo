import type { ReactNode } from "react";
import type { Page } from "@/app";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ListTodo,
  ShieldCheck,
  Activity,
  MessageSquare,
} from "lucide-react";

type LayoutProps = {
  currentPage: string;
  onNavigate: (page: Page) => void;
  children: ReactNode;
};

const navItems: {
  page: Page;
  label: string;
  icon: typeof LayoutDashboard;
}[] = [
  { page: { name: "dashboard" }, label: "Dashboard", icon: LayoutDashboard },
  { page: { name: "jobs" }, label: "Jobs", icon: ListTodo },
  { page: { name: "approvals" }, label: "Approvals", icon: ShieldCheck },
  { page: { name: "sessions" }, label: "Sessions", icon: Activity },
  {
    page: { name: "conversation" },
    label: "Conversations",
    icon: MessageSquare,
  },
];

export function Layout({ currentPage, onNavigate, children }: LayoutProps) {
  return (
    <div className="flex h-screen">
      <aside className="flex w-64 shrink-0 flex-col bg-zinc-900 text-white">
        <div className="border-b border-zinc-800 px-6 py-5">
          <h1 className="text-xl font-bold tracking-tight">Sentinel</h1>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              currentPage === item.page.name ||
              (currentPage === "job-detail" && item.page.name === "jobs");
            return (
              <button
                key={item.page.name}
                onClick={() => {
                  onNavigate(item.page);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-white",
                )}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto bg-zinc-50 p-8 dark:bg-zinc-950">
        {children}
      </main>
    </div>
  );
}
