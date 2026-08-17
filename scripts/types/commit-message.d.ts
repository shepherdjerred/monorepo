export type CommitMessageValidation =
  | { valid: true }
  | { valid: false; error: string };

export function stripCommitMessageComments(message: string): string;

export function validCommitScopes(repositoryRoot: string): Promise<string[]>;

export function validateCommitMessage(
  message: string,
  repositoryRoot: string,
): Promise<CommitMessageValidation>;
