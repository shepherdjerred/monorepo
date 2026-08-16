import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#src/components/dialog.tsx";

export function FormDialogFrame(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description === undefined ? null : (
            <DialogDescription>{props.description}</DialogDescription>
          )}
        </DialogHeader>
        {props.children}
        <DialogFooter>{props.footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
