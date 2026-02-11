import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@shepherdjerred/scout-frontend/components/ui/navigation-menu";

type NavItem = {
  href: string;
  label: string;
  icon?: string;
  external?: boolean;
};

type Props = {
  items: NavItem[];
};

export function ClientNavigation({ items }: Props) {
  return (
    <NavigationMenu>
      <NavigationMenuList>
        {items.map((item) => (
          <NavigationMenuItem key={item.href}>
            <NavigationMenuLink
              href={item.href}
              className={navigationMenuTriggerStyle()}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
            >
              {item.label}
            </NavigationMenuLink>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
