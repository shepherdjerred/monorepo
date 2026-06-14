package sjer.red.openai.dependencyversioncheck.attempt1;

import java.util.List;
import java.util.function.Function;

/**
 * PROBLEM: Dependency Version Check
 * <p>
 * PART 3: Hierarchical binary search on semver structure.
 * See the root DependencyVersionCheckP3 for the full problem description.
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~30-45 minutes)
 */
public class DependencyVersionCheckP3 {

    /**
     * Find earliest supporting version using hierarchical binary search on semver structure.
     * Return null if no version supports the feature.
     */
    public String findEarliest(List<String> versions, Function<String, Boolean> supportsFeature) {
        // TODO: implement hierarchical binary search
        return versions.stream().filter(supportsFeature::apply).findFirst().orElse(null);
    }
}
