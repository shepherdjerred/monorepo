package sjer.red.openai.cddirectory;

import java.util.Map;

/**
 * PROBLEM: cd (Change Directory)
 * <p>
 * PART 3: Symbolic Link Support
 * - cd(currentDir, newDir) — basic path resolution (from Part 1)
 * - cdWithHome(currentDir, newDir, homeDir) — home directory expansion (from Part 2)
 * - cdWithSymlinks(currentDir, newDir, symlinks) — resolve symbolic links
 * - After resolving the path, check if it matches any symlink source
 * - Use longest-match: if both "/usr" and "/usr/local/bin" are symlinks,
 * prefer "/usr/local/bin" for path "/usr/local/bin/foo"
 * - Detect symlink cycles and throw IllegalArgumentException
 * - Symlinks only apply to the final resolved path (not during resolution)
 * <p>
 * Examples:
 * cdWithSymlinks("/home", "/usr/bin", {"/usr/bin"→"/opt/bin"})
 * → "/opt/bin"
 * cdWithSymlinks("/", "/usr/local/bin",
 * {"/usr/local/bin"→"/opt/local/bin", "/usr"→"/system/usr"})
 * → "/opt/local/bin"  (longest match wins)
 * cdWithSymlinks("/", "/a", {"/a"→"/b", "/b"→"/a"})
 * → throws IllegalArgumentException (cycle detected)
 * <p>
 * TIME TARGET: ~15 minutes (cumulative ~35-40 minutes)
 */
public class CdDirectoryP3 {

    /**
     * Resolve newDir relative to currentDir and return the absolute path.
     */
    public String cd(String currentDir, String newDir) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Resolve newDir relative to currentDir with home directory expansion.
     * "~" at the start of newDir expands to homeDir.
     */
    public String cdWithHome(String currentDir, String newDir, String homeDir) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Resolve newDir relative to currentDir, then apply symbolic link resolution.
     * Uses longest-match for symlink sources. Detects cycles.
     */
    public String cdWithSymlinks(String currentDir, String newDir, Map<String, String> symlinks) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
