// Types for naming.js, for the dotfiles test suite's typecheck.

export const MODEL: string;
export const RESPONSES_URL: string;
export const KEY_REF: string;
export const TIMEOUT_MS: number;

export type NamingBody = {
  model: string;
  store: boolean;
  reasoning: { effort: string };
  instructions: string;
  input: string;
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: boolean;
      schema: {
        type: "object";
        additionalProperties: boolean;
        required: string[];
        properties: Record<string, { type: string }>;
      };
    };
  };
};

export function namingBody(message: string): NamingBody;
export function namingRequest(
  message: string,
  key: string,
): {
  method: "POST";
  headers: { Authorization: string; "Content-Type": string };
  body: string;
};
export function branchName(text: string): string;
export function freeBranch(
  base: string,
  taken: (name: string) => Promise<boolean>,
): Promise<string>;
export function parseNaming(
  status: number,
  body: unknown,
): { branch: string; title: string };
