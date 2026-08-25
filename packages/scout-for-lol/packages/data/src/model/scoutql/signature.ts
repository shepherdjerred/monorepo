import { scoutQlContextAt } from "#src/model/scoutql/editor-context.ts";
import {
  scoutQlFunction,
  type ScoutQlFunctionInfo,
} from "#src/model/scoutql/catalog-functions.ts";

// ── signatureHelpScoutQl ─────────────────────────────────────────────────────
// The enclosing call comes from the token-level paren stack rather than the
// AST, because signature help is wanted at exactly the moment the call is
// still unfinished (`QUANTILE_CONT(kills, ` has no AST node). The signatures
// themselves come from the function registry, so help and validation cannot
// disagree about arity.

export type ScoutQlParameterInfo = { label: string; documentation: string };

export type ScoutQlSignatureInfo = {
  label: string;
  documentation: string;
  parameters: ScoutQlParameterInfo[];
};

export type ScoutQlSignatureHelp = {
  signatures: ScoutQlSignatureInfo[];
  activeSignature: number;
  activeParameter: number;
};

function signaturesOf(info: ScoutQlFunctionInfo): ScoutQlSignatureInfo[] {
  return info.signatures.map((signature) => ({
    label: signature.label,
    documentation: info.docMarkdown,
    parameters: signature.params.map((param) => ({
      label: param.label,
      documentation: param.doc,
    })),
  }));
}

/**
 * The first overload that has a parameter for the argument being typed —
 * `COUNT(` with one argument underway means `COUNT(x)`, not `COUNT(*)`.
 */
function activeSignatureIndex(
  signatures: ScoutQlSignatureInfo[],
  argIndex: number,
): number {
  const index = signatures.findIndex(
    (signature) => signature.parameters.length > argIndex,
  );
  return index === -1 ? 0 : index;
}

/**
 * Signature help for the call surrounding an offset, or undefined when the
 * offset is not inside a known function's argument list.
 */
export function signatureHelpScoutQl(
  text: string,
  offset: number,
): ScoutQlSignatureHelp | undefined {
  const context = scoutQlContextAt(text, offset);
  const call = context.call;
  if (call?.callee === undefined) {
    return undefined;
  }
  const info = scoutQlFunction(call.callee);
  if (info === undefined) {
    return undefined;
  }
  const signatures = signaturesOf(info);
  if (signatures.length === 0) {
    return undefined;
  }
  const activeSignature = activeSignatureIndex(signatures, call.argIndex);
  const parameters = signatures[activeSignature]?.parameters.length ?? 0;
  return {
    signatures,
    activeSignature,
    activeParameter: Math.min(call.argIndex, Math.max(parameters - 1, 0)),
  };
}
