package sjer.red.openai.cddirectory;

import java.util.Map;

/**
 * PROBLEM: cd (Change Directory)
 * <p>
 * PART 3: Symbolic Link Support
 * - cd(currentDir, newDir, homeDir, symlinks) — resolve symbolic links
 * - After resolving the path, check if it matches any symlink source
 * - Use longest-match: if both "/usr" and "/usr/local/bin" are symlinks,
 *   prefer "/usr/local/bin" for path "/usr/local/bin/foo"
 * - Detect symlink cycles and throw IllegalArgumentException
 * - Symlinks only apply to the final resolved path (not during resolution)
 * <p>
 * Examples:
 * cd("/home", "/usr/bin", "/home/default", {"/usr/bin"→"/opt/bin"})
 *   → "/opt/bin"
 * cd("/", "/usr/local/bin", "/home/default",
 *   {"/usr/local/bin"→"/opt/local/bin", "/usr"→"/system/usr"})
 *   → "/opt/local/bin"  (longest match wins)
 * cd("/", "/a", "/home/default", {"/a"→"/b", "/b"→"/a"})
 *   → throws IllegalArgumentException (cycle detected)
 * <p>
 * TIME TARGET: ~15 minutes (cumulative ~35-40 minutes)
 */
public class CdDirectoryP3 {

    /**
     * Resolve newDir relative to currentDir with home directory expansion and symbolic link resolution.
     * Uses longest-match for symlink sources. Detects cycles.
     */
    public String cd(String currentDir, String newDir, String homeDir, Map<String, String> symlinks) {
        throw new UnsupportedOperationException("TODO");
    }
}
