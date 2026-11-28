import { isCivilDay, type CivilDay } from "./civil-day.ts";

const weekdays = [
  ["MO", "Monday"],
  ["TU", "Tuesday"],
  ["WE", "Wednesday"],
  ["TH", "Thursday"],
  ["FR", "Friday"],
  ["SA", "Saturday"],
  ["SU", "Sunday"],
] as const;
const repeatLine = /^(?:RRULE:)?FREQ=/i;

function ruleParts(line: string): string[] {
  return line
    .trim()
    .split(";")
    .map((part) => part.trim());
}

function isRuleKey(part: string, key: string): boolean {
  return part
    .replace(/^RRULE:/i, "")
    .toUpperCase()
    .startsWith(`${key}=`);
}

function ruleValue(rule: string, key: string): string {
  const line = rule.split(/\r?\n/).find((part) => repeatLine.test(part.trim()));
  return line === undefined
    ? ""
    : (ruleParts(line)
        .find((part) => isRuleKey(part, key))
        ?.split("=")[1] ?? "");
}

function replaceRuleValue(rule: string, key: string, value: string): string {
  return rule
    .split(/\r?\n/)
    .map((line) => {
      if (!repeatLine.test(line.trim())) return line;
      const parts = ruleParts(line).filter((part) => !isRuleKey(part, key));
      if (value !== "") parts.push(`${key}=${value}`);
      return parts.join(";");
    })
    .join("\n");
}

type RepeatProps = {
  rule: string;
  dueDate: CivilDay;
  onChange: (rule: string) => void;
};

function EndOptions({ rule, dueDate, onChange }: RepeatProps) {
  const count = ruleValue(rule, "COUNT");
  const until = ruleValue(rule, "UNTIL");
  const untilParts = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(until);
  const date = untilParts === null ? "" : untilParts.slice(1).join("-");
  const ending = count === "" ? (until === "" ? "never" : "date") : "count";
  function changeEnd(value: string) {
    const next = replaceRuleValue(
      replaceRuleValue(rule, "COUNT", ""),
      "UNTIL",
      "",
    );
    if (value === "count") onChange(replaceRuleValue(next, "COUNT", "10"));
    else if (value === "date")
      onChange(replaceRuleValue(next, "UNTIL", dueDate.replaceAll("-", "")));
    else onChange(next);
  }
  return (
    <div className="feature-fields">
      <label>
        End repeat
        <select
          value={ending}
          onChange={(event) => {
            changeEnd(event.target.value);
          }}
        >
          <option value="never">Never</option>
          <option value="date">On a date</option>
          <option value="count">After a number of times</option>
        </select>
      </label>
      {ending === "count" ? (
        <label>
          Number of occurrences
          <input
            type="number"
            min="1"
            value={count}
            onChange={(event) => {
              if (event.target.value !== "" && event.target.validity.valid)
                onChange(replaceRuleValue(rule, "COUNT", event.target.value));
            }}
          />
        </label>
      ) : null}
      {ending === "date" ? (
        <label>
          Ends on
          <input
            type="date"
            value={date}
            onChange={(event) => {
              if (isCivilDay(event.target.value))
                onChange(
                  replaceRuleValue(
                    rule,
                    "UNTIL",
                    event.target.value.replaceAll("-", ""),
                  ),
                );
            }}
          />
        </label>
      ) : null}
    </div>
  );
}

export function RepeatBuilder({ rule, dueDate, onChange }: RepeatProps) {
  const frequency = ruleValue(rule, "FREQ").toUpperCase();
  if (frequency === "") return null;
  const selectedDays = ruleValue(rule, "BYDAY").split(",").filter(Boolean);
  return (
    <div className="feature-form">
      <label>
        Every
        <input
          type="number"
          min="1"
          value={ruleValue(rule, "INTERVAL")}
          placeholder="1"
          onChange={(event) => {
            if (event.target.validity.valid)
              onChange(replaceRuleValue(rule, "INTERVAL", event.target.value));
          }}
        />
      </label>
      {frequency === "WEEKLY" ? (
        <fieldset>
          <legend>Days of the week</legend>
          <div className="feature-chips">
            {weekdays.map(([code, label]) => (
              <label className="feature-check" key={code}>
                <input
                  type="checkbox"
                  checked={selectedDays.includes(code)}
                  onChange={(event) => {
                    const days = event.target.checked
                      ? [...selectedDays, code]
                      : selectedDays.filter((day) => day !== code);
                    onChange(replaceRuleValue(rule, "BYDAY", days.join(",")));
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <EndOptions rule={rule} dueDate={dueDate} onChange={onChange} />
    </div>
  );
}
