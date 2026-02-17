import { Location } from "../ast";

/**
 * Error raised when parsing fails.
 */
export class ParseError extends Error {
  name: string;
  fileName: string;
  lineNumber: number;
  charNumber: number;

  constructor(message: string, loc: Location) {
    super(message);
    this.lineNumber = loc.line;
    this.charNumber = loc.char;
    this.name = "ParseError";
    this.stack = `ParseError: ${message}\n    at ${this.fileName ? this.fileName + ":" : ""}${this.lineNumber}:${this.charNumber}`;
  }

  toString(): string {
    return `${this.message} at ${this.fileName ? this.fileName + ":" : ""}${this.lineNumber}:${this.charNumber}`;
  }
}

// Every ParseError has the same name
ParseError.prototype.name = "ParseError";
