import { Location } from "../ast";

export interface Token extends Location {
  text: string;
}

export function Token(location: Location, text: string) {
  return {
    line: location.line,
    char: location.char,
    text
  };
}