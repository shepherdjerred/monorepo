package sjer.red.openai.dependencyversioncheck;

import java.util.List;
import java.util.function.Function;

/**
 * PROBLEM: Dependency Version Check
 * <p>
 * Find the earliest version of a dependency that supports a given feature.
 * <p>
 * PART 1:
 * - Given a sorted list of versions (strings like "1.0", "1.1", "2.0", etc.)
 * - Given a function supportsFeature(version) → boolean
 * - Assumption: if version N supports the feature, all versions > N also support it (monotonic)
 * - Find the earliest version that supports the feature
 * - Optimize: use binary search (don't check every version)
 * <p>
 * TIME TARGET: ~10-15 minutes
 */
public class DependencyVersionCheckP1 {

    /**
     * Part 1: Find earliest supporting version assuming monotonicity.
     * Use binary search. Return null if no version supports the feature.
     */
    public String findEarliestMonotonic(List<String> versions, Function<String, Boolean> supportsFeature) {
        // TODO: implement with binary search
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
