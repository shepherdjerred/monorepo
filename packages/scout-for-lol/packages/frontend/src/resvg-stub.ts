// Stub for @resvg/resvg-js - only needed on server side
// This is never actually called in the browser

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Stub class for browser compatibility
export class Resvg {
  constructor() {
    throw new Error("Resvg is not available in the browser");
  }
}
