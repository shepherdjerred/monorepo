import { normalizeMemoryText } from "@shepherdjerred/birmel/memory/serialization.ts";

const ALIAS_SHAPE =
  /^[\p{L}\p{N}][\p{L}\p{N}'’.-]*(?: [\p{L}\p{N}][\p{L}\p{N}'’.-]*){0,2}$/u;
const DISALLOWED_ALIAS_TOKENS = new Set([
  "a",
  "ai",
  "an",
  "and",
  "as",
  "assistant",
  "bot",
  "channel",
  "discord",
  "github",
  "google",
  "message",
  "or",
  "server",
  "the",
  "tool",
]);

export function assertAcceptedAliasEvidence(options: {
  alias: string;
  userMessage: string;
  assistantMessage: string;
}): string {
  const canonicalAlias = options.alias
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/g, " ");
  const normalizedAlias = normalizeMemoryText(canonicalAlias);
  const aliasTokens = normalizedAlias.split(" ");
  const hasSafeShape =
    normalizedAlias.length >= 4 &&
    normalizedAlias.length <= 40 &&
    ALIAS_SHAPE.test(normalizedAlias) &&
    !aliasTokens.some((token) => DISALLOWED_ALIAS_TOKENS.has(token));
  const normalizedUserMessage = normalizeMemoryText(options.userMessage);
  const normalizedAssistantMessage = normalizeMemoryText(
    options.assistantMessage,
  );
  const userRejected = [
    `not call you ${normalizedAlias}`,
    `never call you ${normalizedAlias}`,
    `don't call you ${normalizedAlias}`,
    `don’t call you ${normalizedAlias}`,
    `do not call you ${normalizedAlias}`,
    `won't call you ${normalizedAlias}`,
    `won’t call you ${normalizedAlias}`,
    `cannot call you ${normalizedAlias}`,
    `can't call you ${normalizedAlias}`,
    `can’t call you ${normalizedAlias}`,
    `not name you ${normalizedAlias}`,
    `not refer to you as ${normalizedAlias}`,
  ].some((phrase) => normalizedUserMessage.includes(phrase));
  const assistantRejected = [
    `not call me ${normalizedAlias}`,
    `never call me ${normalizedAlias}`,
    `don't call me ${normalizedAlias}`,
    `don’t call me ${normalizedAlias}`,
    `do not call me ${normalizedAlias}`,
    `cannot call me ${normalizedAlias}`,
    `can't call me ${normalizedAlias}`,
    `can’t call me ${normalizedAlias}`,
    `not answer to ${normalizedAlias}`,
    `never answer to ${normalizedAlias}`,
    `won't answer to ${normalizedAlias}`,
    `won’t answer to ${normalizedAlias}`,
    `refuse to answer to ${normalizedAlias}`,
    `${normalizedAlias} it is not`,
  ].some((phrase) => normalizedAssistantMessage.includes(phrase));
  const proposed = [
    `call you ${normalizedAlias}`,
    `name you ${normalizedAlias}`,
    `refer to you as ${normalizedAlias}`,
    `your name be ${normalizedAlias}`,
    `your name to ${normalizedAlias}`,
  ].some((phrase) => normalizedUserMessage.includes(phrase));
  const accepted = [
    `call me ${normalizedAlias}`,
    `refer to me as ${normalizedAlias}`,
    `my name is ${normalizedAlias}`,
    `answer to ${normalizedAlias}`,
    `${normalizedAlias} it is`,
  ].some((phrase) => normalizedAssistantMessage.includes(phrase));
  if (
    !hasSafeShape ||
    !proposed ||
    !accepted ||
    userRejected ||
    assistantRejected
  ) {
    throw new Error(
      "Accepted alias requires a safe wake name plus explicit proposal and acceptance",
    );
  }
  return canonicalAlias;
}
