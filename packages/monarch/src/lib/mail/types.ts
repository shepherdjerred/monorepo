// One entry per message in the header index (bodies are parsed lazily).
export type EmailIndexEntry = {
  path: string;
  account: string;
  mailbox: string;
  from: string;
  subject: string;
  // ISO yyyy-mm-dd; empty string when the Date header is unparseable
  date: string;
};

export type ParsedEmail = {
  headers: Record<string, string>;
  from: string;
  subject: string;
  date: string;
  messageId: string;
  // Decoded text body: text/plain preferred, tag-stripped text/html fallback
  textBody: string;
};
