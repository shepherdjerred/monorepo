import type { ModalComponent } from "../types";
import { ComponentRenderer } from "../ComponentRegistry";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
} from "@/components/ui/dialog";

interface A2UIModalProps {
  id: string;
  component: ModalComponent["Modal"];
  surfaceId: string;
}

export function A2UIModal({ component, surfaceId }: A2UIModalProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <div>
          <ComponentRenderer
            componentId={component.entryPointChild}
            surfaceId={surfaceId}
          />
        </div>
      </DialogTrigger>
      <DialogContent>
        <ComponentRenderer
          componentId={component.contentChild}
          surfaceId={surfaceId}
        />
      </DialogContent>
    </Dialog>
  );
}
