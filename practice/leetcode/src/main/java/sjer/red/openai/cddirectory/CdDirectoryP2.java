package sjer.red.openai.cddirectory;

import java.util.Stack;

/**
 * PROBLEM: cd (Change Directory)
 * <p>
 * PART 2: Home Directory Support
 * - cd(currentDir, newDir, homeDir) — add "~" home directory expansion
 * - "~" at the START of newDir expands to homeDir (e.g. "~/docs" → "/home/jerred/docs")
 * - "~" NOT at the start is treated as a literal character (e.g. "a/~" → currentDir + "/a/~")
 * - After expansion, resolve ".", ".." as usual
 * <p>
 * Examples:
 * cd("/tmp", "~", "/home/jerred")       → "/home/jerred"
 * cd("/tmp", "~/docs", "/home/jerred")   → "/home/jerred/docs"
 * cd("/anywhere", "~/docs/..", "/home/jerred") → "/home/jerred"
 * cd("/tmp", "a/~", "/home/jerred")      → "/tmp/a/~"
 * <p>
 * TIME TARGET: ~10 minutes (cumulative ~20-25 minutes)
 */
public class CdDirectoryP2 {

    /**
     * Resolve newDir relative to currentDir with home directory expansion.
     * "~" at the start of newDir expands to homeDir.
     */
    public String cd(String currentDir, String newDir, String homeDir) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
