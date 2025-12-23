import { Dictionary } from "../util";
import { Location   } from "./location";

export interface Undefined extends Location {
  type: "Undefined";
}

export function Undefined(location: Location): Undefined {
  return {
    type: "Undefined",
    line: location.line,
    char: location.char
  };
}

export interface Null extends Location {
  type: "Null";
}

export function Null(location: Location): Null {
  return {
    type: "Null",
    line: location.line,
    char: location.char
  };
}

export interface Boolean extends Location {
  type: "Boolean";
  value: boolean;
}

export function Boolean(location: Location, value: boolean): Boolean {
  return {
    type: "Boolean",
    line: location.line,
    char: location.char,
    value
  };
}

export interface Number extends Location {
  type: "Number";
  value: number;
}

export function Number(location: Location, value: number): Number {
  return {
    type: "Number",
    line: location.line,
    char: location.char,
    value
  };
}

export interface String extends Location {
  type: "String";
  value: string;
}

export function String(location: Location, value: string): String {
  return {
    type: "String",
    line: location.line,
    char: location.char,
    value
  };
}

export interface Identifier extends Location {
  type: "Identifier";
  text: string;
}

export function Identifier(location: Location, text: string): Identifier {
  return {
    type: "Identifier",
    line: location.line,
    char: location.char,
    text
  };
}

export interface Property extends Location {
  type: "Property";
  object: Expression;
  property: Identifier;
}

export function Property(
    location: Location,
    object: Expression,
    property: Identifier
): Property {
  return {
    type: "Property",
    line: location.line,
    char: location.char,
    object,
    property
  };
}

export interface Index extends Location {
  type: "Index";
  object: Expression;
  index: Expression;
}

export function Index(
    location: Location,
    object: Expression,
    index: Expression
): Index {
  return {
    type: "Index",
    line: location.line,
    char: location.char,
    object,
    index
  };
}

export interface Application extends Location {
  type: "Application";
  fn: Expression;
  args: Expression[];
}

export function Application(
    location: Location,
    fn: Expression,
    args: Expression[]
): Application {
  return {
    type: "Application",
    line: location.line,
    char: location.char,
    fn,
    args
  };
}

export interface UnaryOperation extends Location {
  type: "UnaryOperation";
  op: string;
  right: Expression;
}

export function UnaryOperation(
  location: Location,
  op: string,
  right: Expression
): UnaryOperation {
  return {
    type: "UnaryOperation",
    line: location.line,
    char: location.char,
    op,
    right
  };
}

export interface BinaryOperation extends Location {
  type: "BinaryOperation";
  op: string;
  left: Expression;
  right: Expression;
}

export function BinaryOperation(
    location: Location,
    left: Expression,
    op: string,
    right: Expression
): BinaryOperation {
  return {
    type: "BinaryOperation",
    line: location.line,
    char: location.char,
    left,
    op,
    right
  };
}

export interface ArrayConstruction extends Location {
  type: "ArrayConstruction";
  value: Expression[];
}

export function ArrayConstruction(
    location: Location,
    value: Expression[]
): ArrayConstruction {
  return {
    type: "ArrayConstruction",
    line: location.line,
    char: location.char,
    value
  };
}

export interface ObjectConstruction extends Location {
  type: "ObjectConstruction";
  value: Dictionary<Expression>;
}

export function ObjectConstruction(
    location: Location,
    value: Dictionary<Expression>
): ObjectConstruction {
  return {
    type: "ObjectConstruction",
    line: location.line,
    char: location.char,
    value
  };
}

export type Expression =
  Undefined | Null | Boolean | Number | String |
  Identifier | Property | Index | Application |
  UnaryOperation | BinaryOperation |
  ArrayConstruction | ObjectConstruction;
