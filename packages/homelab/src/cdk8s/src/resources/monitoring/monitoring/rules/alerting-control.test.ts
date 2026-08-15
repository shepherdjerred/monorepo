import { describe, expect, it } from "bun:test";
import {
  getAlertingControlRuleGroups,
  INFO_INHIBITOR_EXPRESSION,
} from "./alerting-control.ts";

describe("alerting control rules", () => {
  it("inhibits only firing info alerts", () => {
    const [group] = getAlertingControlRuleGroups();
    const [rule] = group?.rules ?? [];

    expect(rule?.alert).toBe("InfoInhibitor");
    expect(rule?.labels).toEqual({ severity: "none" });
    expect(rule?.expr.value).toBe(INFO_INHIBITOR_EXPRESSION);
    expect(INFO_INHIBITOR_EXPRESSION).toContain(
      'ALERTS{alertstate="firing", severity="info"}',
    );
    expect(INFO_INHIBITOR_EXPRESSION).not.toContain(
      'ALERTS{severity="info"} == 1',
    );
  });

  it("does not let a warning or critical alert inhibit itself", () => {
    expect(INFO_INHIBITOR_EXPRESSION).toContain('alertname!="InfoInhibitor"');
    expect(INFO_INHIBITOR_EXPRESSION).toContain('alertstate="firing"');
    expect(INFO_INHIBITOR_EXPRESSION).toContain('severity=~"warning|critical"');
  });
});
