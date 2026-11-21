// A stylesheet import. Plain sheets are imported for their side effect; a
// CSS Module's default export maps the names it defines to scoped ones (read
// it through `ui/class-names.ts`).
declare module "*.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
