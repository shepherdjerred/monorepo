/**
 * Type declarations for Vite's ?raw import suffix
 * This allows importing text files as strings
 */

declare module "*.txt?raw" {
  const content: string;
  export default content;
}

declare module "*.txt" {
  const content: string;
  export default content;
}

declare module "*.json?raw" {
  const content: string;
  export default content;
}
