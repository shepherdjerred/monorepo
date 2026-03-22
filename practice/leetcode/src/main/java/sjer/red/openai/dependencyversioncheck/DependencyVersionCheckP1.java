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
     * Find earliest supporting version assuming monotonicity.
     * Use binary search. Return null if no version supports the feature.
     */
    public String findEarliest(List<String> versions, Function<String, Boolean> supportsFeature) {
        var left = 0;
        var right = versions.size() - 1;
        Integer min = null;

        while (right >= left) {
            var middle = left + (right - left) / 2;
            if (supportsFeature.apply(versions.get(middle)) == true) {
                right = middle - 1;
                min = middle;
            } else {
                left = middle + 1;
            }
        }

        if (min != null) {
            return versions.get(min);
        } else {
            return null;
        }
    }
}
