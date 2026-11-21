import {
  isWideValue,
  type ParsedSummary,
  type ReceiptFact,
  type ReceiptValue,
} from "#client/evidence.ts";
import { Disclosure } from "./disclosure.tsx";
import { Fact, Facts } from "./facts.tsx";
import { Identifier } from "./identifier.tsx";
import { RelativeTime } from "./time.tsx";

function Value({ value }: { value: ReceiptValue }) {
  switch (value.kind) {
    case "text": {
      return value.text;
    }
    case "identifier": {
      return <Identifier value={value.value} />;
    }
    case "time": {
      return <RelativeTime value={value.value} />;
    }
    case "link": {
      return (
        <a href={value.url}>
          {value.url}
          <span aria-hidden="true"> ↗</span>
        </a>
      );
    }
  }
}

function FactList({ facts }: { facts: ReceiptFact[] }) {
  return (
    <Facts>
      {facts.map((fact) => (
        <Fact key={fact.key} label={fact.label}>
          <Value value={fact.value} />
        </Fact>
      ))}
    </Facts>
  );
}

/**
 * A summary or step message as people read it: prose as written, a machine
 * receipt as labelled facts with its nested values folded away. The
 * receipt's `adapter` is the caller's to show as the item's label.
 */
export function Receipt({ parsed }: { parsed: ParsedSummary }) {
  if (parsed.kind === "text")
    return <p className="receipt-text">{parsed.text}</p>;
  const short = parsed.facts.filter((fact) => !isWideValue(fact.value));
  const wide = parsed.facts.filter((fact) => isWideValue(fact.value));
  return (
    <div className="receipt">
      {short.length > 0 && <FactList facts={short} />}
      {wide.length > 0 && (
        <div className="receipt-wide">
          <FactList facts={wide} />
        </div>
      )}
      {parsed.nested.length > 0 && (
        <Disclosure
          summary={parsed.nested.map((entry) => entry.label).join(", ")}
        >
          {parsed.nested.map((entry) => (
            <figure key={entry.key} className="receipt-nested">
              {/* One nested value is already named by the summary above it. */}
              {parsed.nested.length > 1 && (
                <figcaption className="eyebrow">{entry.label}</figcaption>
              )}
              <pre className="receipt-json">
                <code>{entry.json}</code>
              </pre>
            </figure>
          ))}
        </Disclosure>
      )}
    </div>
  );
}
