package sjer.red.openai.dependencyversioncheck;

import java.util.List;
import java.util.function.Function;

/**
 * PROBLEM: Dependency Version Check
 * <p>
 * Find the earliest version of a dependency that supports a given feature.
 * <p>
 * PART 2 (THE TWIST):
 * - The interviewer provides test cases that BREAK your Part 1 binary search
 * - Example: version 103.003.02 supports the feature, but 103.003.03 does NOT
 * - Global monotonicity is broken — you cannot binary search the full list
 * <p>
 * KEY SKILL TESTED: Observe the test data carefully. Notice that while global
 * monotonicity is broken, there IS a pattern:
 * - Support is non-monotonic within a major version (patches may flip)
 * - But the LAST version of each major group behaves monotonically across groups
 * - i.e., if major 2's last version supports, then major 3's last version also supports
 * <p>
 * You should notice this pattern from the test data and CONFIRM it with the interviewer
 * before exploiting it in Part 3.
 * <p>
 * For now: since you can't binary search, fall back to linear scan.
 * The interviewer wants to see you recognize the broken assumption and adapt.
 * <p>
 * Example:
 * versions = ["1.0.0", "1.0.1", "1.1.0", "2.0.0", "2.0.1", "2.1.0"]
 * supportsFeature("1.0.0") → false
 * supportsFeature("1.0.1") → true
 * supportsFeature("1.1.0") → false  // broken global monotonicity!
 * supportsFeature("2.0.0") → true
 * supportsFeature("2.0.1") → false  // broken again!
 * supportsFeature("2.1.0") → true
 * Answer: "1.0.1"
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~20-30 minutes)
 */
public class DependencyVersionCheckP2 {

    /**
     * Find earliest supporting version WITHOUT global monotonicity assumption.
     * Binary search no longer works on the full list.
     * Return null if no version supports the feature.
     */
    public String findEarliest(List<String> versions, Function<String, Boolean> supportsFeature) {
        return versions.stream().filter(supportsFeature::apply).findFirst().orElse(null);
    }
}
