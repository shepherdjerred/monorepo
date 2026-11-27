// Side-effect stylesheet imports; Vite bundles them.
declare module "*.css";

// lucide-react exposes each icon's data at its subpath, but its types only declare
// the component; the comment pin and cursor read the path from here so they cannot drift.
declare module "lucide-react/icons/message-circle" {
  const iconData: {
    readonly name: string;
    readonly size: number;
    readonly node: readonly (readonly [string, { readonly d: string }])[];
  };
  export { iconData as "__iconData" };
}
