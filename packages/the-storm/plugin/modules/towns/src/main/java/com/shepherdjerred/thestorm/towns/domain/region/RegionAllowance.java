package com.shepherdjerred.thestorm.towns.domain.region;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import java.util.Set;

/**
 * One act ordinary players may do inside a region.
 *
 * @param action the allowed action
 * @param subjects what it may be done to; {@code [ANY]} for everything
 */
public record RegionAllowance(Action action, Set<Subject> subjects) {

  public RegionAllowance {
    subjects = Set.copyOf(subjects);
    if (subjects.isEmpty()) {
      throw new IllegalArgumentException("list at least one subject, or ANY, for " + action);
    }
    if (subjects.contains(Subject.ANY) && subjects.size() > 1) {
      throw new IllegalArgumentException("ANY already covers every subject; list it alone");
    }
  }

  public boolean permits(Act act) {
    return act.action() == action
        && (subjects.contains(Subject.ANY) || subjects.contains(act.subject()));
  }
}
