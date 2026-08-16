import {
  CircleCheck,
  CircleX,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { CSSProperties } from "react";
import {
  Toaster as SonnerToaster,
  toast as sonnerToast,
  type ToasterProps,
} from "sonner";
import { useScoutTheme } from "#src/runtime/context.tsx";

const style: CSSProperties &
  Record<
    "--normal-bg" | "--normal-text" | "--normal-border" | "--border-radius",
    string
  > = {
  "--normal-bg": "var(--scout-color-surface-raised)",
  "--normal-text": "var(--scout-color-text)",
  "--normal-border": "var(--scout-color-border)",
  "--border-radius": "var(--scout-radius-medium)",
};

export function Toaster(props: ToasterProps) {
  const { resolvedMode } = useScoutTheme();
  return (
    <SonnerToaster
      theme={resolvedMode}
      icons={{
        success: <CircleCheck aria-hidden="true" size={16} />,
        info: <Info aria-hidden="true" size={16} />,
        warning: <TriangleAlert aria-hidden="true" size={16} />,
        error: <CircleX aria-hidden="true" size={16} />,
        loading: (
          <LoaderCircle
            aria-hidden="true"
            className="scout-toast__spinner"
            size={16}
          />
        ),
      }}
      style={style}
      {...props}
    />
  );
}

export const toast = {
  success(...parameters: Parameters<typeof sonnerToast.success>) {
    return sonnerToast.success(...parameters);
  },
  error(...parameters: Parameters<typeof sonnerToast.error>) {
    return sonnerToast.error(...parameters);
  },
};
