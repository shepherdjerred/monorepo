package sjer.red.openai.cddirectory;

import java.util.Map;

/**
 * PROBLEM: cd (Change Directory)
 * <p>
 * PART 3: Symbolic Link Support
 * - cd(currentDir, newDir, homeDir, symlinks) — add symbolic link resolution
 * - symlinks is a map from absolute path → absolute target path
 * - Resolve symlinks during path traversal, component by component:
 *   after resolving each component, check if the accumulated path so far
 *   matches any symlink. If it does, replace it with the target and
 *   continue resolving the remaining components from there.
 * - Symlink targets may themselves hit other symlinks (chaining is allowed)
 * - Detect symlink cycles and throw IllegalArgumentException
 * - Handle all Part 1 and Part 2 behaviors (relative, absolute, ".", "..", "~")
 * <p>
 * Examples:
 * cd("/", "/usr/bin", "/home", {"/usr/bin"→"/opt/bin"})
 *   → "/opt/bin"
 * cd("/", "/usr/bin", "/home", {"/usr"→"/opt", "/opt/bin"→"/tools"})
 *   → "/tools"  ("/usr"→"/opt" + remaining "bin" → "/opt/bin"→"/tools")
 * cd("/", "/usr/local/bin", "/home",
 *     {"/usr/local/bin"→"/opt/local/bin", "/usr"→"/system/usr"})
 *   → "/system/usr/local/bin"  ("/usr" resolves first; deeper symlink never reached)
 * cd("/", "/a", "/home", {"/a"→"/b", "/b"→"/a"})
 *   → throws IllegalArgumentException (cycle)
 * <p>
 * TIME TARGET: ~15 minutes (cumulative ~35-40 minutes)
 */
public class CdDirectoryP3 {

    /**
     * Resolve newDir relative to currentDir with home directory expansion and symbolic link resolution.
     * Resolves symlinks component-by-component during traversal. Detects cycles.
     */
    public String cd(String currentDir, String newDir, String homeDir, Map<String, String> symlinks) {
        throw new UnsupportedOperationException("TODO");
    }
}
