// Stub for @resvg/resvg-js - only needed on server side
// This is never actually called in the browser

export class Resvg {
  readonly _stub = true;
  constructor() {
    throw new Error("Resvg is not available in the browser");
  }
}
