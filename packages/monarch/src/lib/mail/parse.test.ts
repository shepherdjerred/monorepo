import { describe, expect, test } from "vitest";
import {
  parseHeaders,
  parseEmail,
  extractTextBody,
  decodeQuotedPrintable,
  stripHtml,
  parseEmailDateHeader,
} from "./parse.ts";

describe("parseHeaders", () => {
  test("parses and unfolds headers, case-insensitive", () => {
    const raw =
      "Return-Path: <x@y.com>\r\n" +
      "From: DoorDash <no-reply@doordash.com>\r\n" +
      "Subject: Your order\r\n\twith Chipotle\r\n" +
      "Date: Mon, 8 Sep 2025 10:00:00 -0700\r\n" +
      "\r\n" +
      "body";
    const h = parseHeaders(raw);
    expect(h["from"]).toBe("DoorDash <no-reply@doordash.com>");
    expect(h["subject"]).toBe("Your order with Chipotle");
  });

  test("handles LF-only messages", () => {
    const h = parseHeaders("From: a@b.com\nSubject: hi\n\nbody");
    expect(h["subject"]).toBe("hi");
  });

  test("keeps the first occurrence of a repeated header", () => {
    const h = parseHeaders("Received: one\nReceived: two\n\n");
    expect(h["received"]).toBe("one");
  });
});

describe("decodeQuotedPrintable", () => {
  test("repairs soft line breaks that split prices", () => {
    // The exact failure mode that emptied Apple receipt items
    const qp = "Headspace: Mindful Meditation             $=\n12.99";
    expect(decodeQuotedPrintable(qp)).toBe(
      "Headspace: Mindful Meditation             $12.99",
    );
  });

  test("decodes hex escapes", () => {
    expect(decodeQuotedPrintable("caf=C3=A9")).toBe("café".normalize());
  });
});

describe("extractTextBody", () => {
  test("prefers text/plain in multipart/alternative", () => {
    const raw =
      'Content-Type: multipart/alternative; boundary="b1"\n' +
      "\n" +
      "--b1\n" +
      "Content-Type: text/plain\n" +
      "\n" +
      "plain body\n" +
      "--b1\n" +
      "Content-Type: text/html\n" +
      "\n" +
      "<p>html body</p>\n" +
      "--b1--\n";
    expect(extractTextBody(raw).trim()).toBe("plain body");
  });

  test("handles nested multipart/mixed wrapping multipart/alternative", () => {
    const inner =
      'Content-Type: multipart/alternative; boundary="inner"\n' +
      "\n" +
      "--inner\n" +
      "Content-Type: text/plain\n" +
      "\n" +
      "nested plain\n" +
      "--inner--\n";
    const raw =
      'Content-Type: multipart/mixed; boundary="outer"\n' +
      "\n" +
      "--outer\n" +
      inner +
      "--outer--\n";
    expect(extractTextBody(raw).trim()).toBe("nested plain");
  });

  test("falls back to tag-stripped html", () => {
    const raw =
      'Content-Type: multipart/alternative; boundary="b"\n' +
      "\n" +
      "--b\n" +
      "Content-Type: text/html\n" +
      "Content-Transfer-Encoding: quoted-printable\n" +
      "\n" +
      "<p>Total: $12=\n.99</p>\n" +
      "--b--\n";
    expect(extractTextBody(raw)).toContain("Total: $12.99");
  });

  test("decodes base64 bodies", () => {
    const raw =
      "Content-Type: text/plain\n" +
      "Content-Transfer-Encoding: base64\n" +
      "\n" +
      Buffer.from("order total $5.00").toString("base64");
    expect(extractTextBody(raw)).toBe("order total $5.00");
  });

  test("single-part plain message", () => {
    expect(extractTextBody("Content-Type: text/plain\n\nhello")).toBe("hello");
  });
});

describe("stripHtml", () => {
  test("removes tags, styles, and entities", () => {
    expect(stripHtml("<style>p{}</style><p>a &amp; b&nbsp;&lt;c&gt;</p>")).toBe(
      "a & b <c>",
    );
  });
});

describe("parseEmailDateHeader", () => {
  test("parses RFC2822 dates to ISO", () => {
    expect(parseEmailDateHeader("Mon, 8 Sep 2025 10:00:00 -0700")).toBe(
      "2025-09-08",
    );
  });

  test("returns empty string on garbage", () => {
    expect(parseEmailDateHeader("not a date")).toBe("");
  });
});

describe("parseEmail", () => {
  test("full round trip", () => {
    const raw =
      "From: Uber Receipts <noreply@uber.com>\n" +
      "Subject: Your Tuesday trip\n" +
      "Date: Tue, 9 Sep 2025 08:00:00 +0000\n" +
      "Message-Id: <abc@uber.com>\n" +
      "Content-Type: text/plain\n" +
      "\n" +
      "Total: $23.45";
    const email = parseEmail(raw);
    expect(email.from).toContain("uber.com");
    expect(email.date).toBe("2025-09-09");
    expect(email.textBody).toContain("$23.45");
  });
});
