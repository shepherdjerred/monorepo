package sjer.red.openai.cddirectory;

/**
 * PROBLEM: cd (Change Directory)
 * <p>
 * PART 2: Home Directory Support
 * - cd(currentDir, newDir) — basic path resolution (from Part 1)
 * - cdWithHome(currentDir, newDir, homeDir) — add "~" home directory expansion
 * - "~" at the START of newDir expands to homeDir (e.g. "~/docs" → "/home/jerred/docs")
 * - "~" NOT at the start is treated as a literal character (e.g. "a/~" → currentDir + "/a/~")
 * - After expansion, resolve ".", ".." as usual
 * <p>
 * Examples:
 * cdWithHome("/tmp", "~", "/home/jerred")       → "/home/jerred"
 * cdWithHome("/tmp", "~/docs", "/home/jerred")   → "/home/jerred/docs"
 * cdWithHome("/anywhere", "~/docs/..", "/home/jerred") → "/home/jerred"
 * cdWithHome("/tmp", "a/~", "/home/jerred")      → "/tmp/a/~"
 * <p>
 * TIME TARGET: ~10 minutes (cumulative ~20-25 minutes)
 */
public class CdDirectoryP2 {

    public String cd(String currentDir, String newDir, String homeDir) {
        throw new UnsupportedOperationException("TODO");
    }
}
