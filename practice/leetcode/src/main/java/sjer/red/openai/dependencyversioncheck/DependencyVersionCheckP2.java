package sjer.red.openai.dependencyversioncheck;

import java.util.List;
import java.util.function.Function;

/**
 * PROBLEM: Dependency Version Check
 * <p>
 * Find the earliest version of a dependency that supports a given feature.
 * <p>
 * PART 2 (THE TWIST):
 * - Monotonicity assumption is BROKEN
 * - Version N+1 may NOT support a feature that version N supports
 * - The support function is noisy / non-monotonic
 * - Must iteratively refine approach based on results
 * - Find ALL versions that support the feature, then return the earliest
 * <p>
 * Example:
 * versions = ["1.0", "1.1", "1.2", "1.3", "1.4", "2.0"]
 * supportsFeature("1.0") → false
 * supportsFeature("1.1") → true
 * supportsFeature("1.2") → false  // broken monotonicity!
 * supportsFeature("1.3") → true
 * supportsFeature("1.4") → true
 * supportsFeature("2.0") → true
 * Answer: "1.1"
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~20-30 minutes)
 */
public class DependencyVersionCheckP2 {

    /**
     * Find earliest supporting version WITHOUT monotonicity assumption.
     * Must check all versions (or be clever about it).
     * Return null if no version supports the feature.
     */
    public String findEarliest(List<String> versions, Function<String, Boolean> supportsFeature) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
