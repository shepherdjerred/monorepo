import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@scout-for-lol/frontend/components/ui/sheet";
import { Button } from "@scout-for-lol/frontend/components/ui/button";

type MobileNavItem = {
  href: string;
  label: string;
  icon?: string;
  external?: boolean;
  activePage?: string;
  currentPage?: string;
};

type Props = {
  items: MobileNavItem[];
  activePage?: string | undefined;
  discordLink: string;
};

export function ClientMobileNav({ items, activePage, discordLink }: Props) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-6 w-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <div className="space-y-1 px-2 pb-3 pt-2">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
              className={
                activePage === item.currentPage
                  ? "block rounded-md px-3 py-2 text-base font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400"
                  : "block rounded-md px-3 py-2 text-base font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
              }
            >
              {item.label}
            </a>
          ))}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
            <a
              href={discordLink}
              className="block rounded-md bg-indigo-600 px-3 py-2 text-base font-semibold text-white text-center shadow-sm hover:bg-indigo-500"
            >
              Add to Discord
            </a>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
