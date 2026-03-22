package sjer.red.openai.dependencyversioncheck;

import java.util.List;
import java.util.function.Function;

/**
 * PROBLEM: Dependency Version Check
 * <p>
 * Find the earliest version of a dependency that supports a given feature.
 * <p>
 * PART 3:
 * - Minimize the number of calls to supportsFeature()
 * - Versions use semver format: "major.minor.patch" (e.g., "103.003.02")
 * - Global monotonicity is broken (from Part 2), BUT:
 *   - The LAST version within each major group behaves monotonically across major groups
 *   - i.e., if major M's last version supports, all major versions > M also have last version supporting
 *   - Same hierarchical monotonicity applies: major → minor → patch
 * <p>
 * APPROACH: Hierarchical binary search
 *   1. Group versions by major version. For each group, identify the LAST version.
 *   2. Binary search across major groups (checking last version of each) → find first supporting major
 *   3. Within that major, group by minor. Binary search last version per minor → first supporting minor
 *   4. Within that minor, binary search individual patches → find earliest supporting patch
 * <p>
 * COMPLEXITY: O(log M + log N + log P) calls instead of O(total versions)
 *   where M = distinct majors, N = distinct minors in winning major, P = patches in winning minor
 * <p>
 * Example:
 * versions = ["1.0.0", "1.0.1", "1.1.0", "1.1.1", "2.0.0", "2.0.1", "2.1.0", "2.1.1"]
 * Only "1.0.1", "1.1.1", "2.0.0", "2.0.1", "2.1.0", "2.1.1" support the feature.
 * <p>
 * Step 1: Check last version per major: "1.1.1" → true, "2.1.1" → true
 *         Binary search → major 1 is first supporting major (2 calls max)
 * Step 2: Within major 1, check last per minor: "1.0.1" → true, "1.1.1" → true
 *         Binary search → minor 0 is first supporting minor (2 calls max)
 * Step 3: Within 1.0.*, check: "1.0.0" → false, "1.0.1" → true
 *         Binary search → "1.0.1" is earliest (2 calls max)
 * Total: ~6 calls instead of 8 (bigger savings with more versions)
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~30-45 minutes)
 */
public class DependencyVersionCheckP3 {

    /**
     * Find earliest supporting version using hierarchical binary search on semver structure.
     * Exploit the fact that monotonicity holds at the group level (last version per group).
     * Return null if no version supports the feature.
     */
    public String findEarliest(List<String> versions, Function<String, Boolean> supportsFeature) {
        // TODO: implement hierarchical binary search
        //  1. Parse versions into (major, minor, patch)
        //  2. Group by major → binary search last version per major group
        //  3. Within winning major, group by minor → binary search last version per minor group
        //  4. Within winning minor → binary search patches
        return null;
    }
}
