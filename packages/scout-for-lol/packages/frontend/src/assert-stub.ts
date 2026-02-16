// Stub for Node.js assert module - only needed on server side
// This is never actually called in the browser

export function strict() {
  throw new Error("assert is not available in the browser");
}

export default function assert() {
  throw new Error("assert is not available in the browser");
}
