package sjer.red.openai;

import java.util.Map;

/**
 * PROBLEM: CD Directory / Path Resolution
 *
 * Implement cd(currentDir, newDir) returning the resulting absolute path.
 *
 * PART 1:
 *   - Handle "." (current directory), ".." (parent directory), absolute paths
 *   - currentDir is always an absolute path (starts with "/")
 *   - newDir can be relative or absolute
 *   - Return the resolved absolute path (no trailing slash except root)
 *
 *   Examples:
 *     cd("/home/user", "docs")        → "/home/user/docs"
 *     cd("/home/user", "..")          → "/home"
 *     cd("/home/user", "./docs/../pics") → "/home/user/pics"
 *     cd("/home/user", "/etc")        → "/etc"
 *     cd("/", "..")                   → "/"
 *
 * PART 2:
 *   - Add "~" (home directory) support
 *   - "~" expands to a configurable home directory path
 *   - "~/foo" → "{home}/foo"
 *
 * PART 3:
 *   - Add symbolic link support via a dictionary parameter
 *   - symlinks map a path to another path, e.g. {"/usr/bin": "/opt/bin"}
 *   - Use longest-match priority when resolving
 *   - Detect and handle symlink cycles (throw exception)
 *
 * TIME TARGET: 45-60 minutes for all 3 parts
 */
public class CdDirectory {

    /**
     * Part 1: Resolve a cd command given current directory and new path.
     */
    public String cd(String currentDir, String newDir) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Part 2: Resolve with home directory (~) support.
     */
    public String cdWithHome(String currentDir, String newDir, String homeDir) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Part 3: Resolve with symbolic link support and cycle detection.
     * @param symlinks map from source path to target path
     * @throws IllegalArgumentException if a symlink cycle is detected
     */
    public String cdWithSymlinks(String currentDir, String newDir, Map<String, String> symlinks) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
