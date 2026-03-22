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
 * - Given a budget of maxCalls, find the best answer possible
 * - If you can't check everything, return best guess with confidence
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~30-45 minutes)
 */
public class DependencyVersionCheckP3 {

    /**
     * Find earliest supporting version with a limited budget of calls.
     *
     * @param maxCalls maximum number of times you can call supportsFeature
     * @return best guess for earliest supporting version, or null
     */
    public String findEarliest(List<String> versions, Function<String, Boolean> supportsFeature, int maxCalls) {
        return versions.stream().filter(supportsFeature::apply).findFirst().orElse(null);
    }
}
