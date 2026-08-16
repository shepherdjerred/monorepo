import type { ReactNode } from "react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@scout-for-lol/design-system/components/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@scout-for-lol/design-system/components/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";

export function ResponsiveOverlay({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const desktop = useMediaQuery("(min-width: 640px)");
  if (desktop) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">{label}</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer showSwipeHandle>
      <DrawerTrigger render={<Button variant="outline" />}>
        {label}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[70dvh] overflow-y-auto p-4">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
