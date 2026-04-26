import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "#src/components/ui/navigation-menu.tsx";

type NavItem = {
  href: string;
  label: string;
  icon?: string;
  external?: boolean;
};

type Props = {
  items: NavItem[];
};

const linkClassName =
  "inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-gray-900 dark:text-gray-100 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-indigo-600 dark:hover:text-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export function ClientNavigation({ items }: Props) {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        {items.map((item) => (
          <NavigationMenuItem key={item.href}>
            <NavigationMenuLink
              href={item.href}
              className={linkClassName}
              target={item.external === true ? "_blank" : undefined}
              rel={item.external === true ? "noopener noreferrer" : undefined}
            >
              {item.label}
            </NavigationMenuLink>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
