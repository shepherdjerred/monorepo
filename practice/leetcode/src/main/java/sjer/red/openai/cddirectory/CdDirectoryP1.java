package sjer.red.openai.cddirectory;

/**
 * PROBLEM: cd (Change Directory)
 * <p>
 * PART 1: Basic Path Resolution
 * - cd(currentDir, newDir) — resolve a new path given the current directory
 * - Handle "." (current directory) and ".." (parent directory)
 * - Handle absolute paths (starting with "/") — ignore currentDir
 * - Handle relative paths — resolve relative to currentDir
 * - ".." at root "/" stays at root
 * - Return the resolved absolute path (no trailing slash except root)
 * <p>
 * Examples:
 * cd("/home/user", "docs")         → "/home/user/docs"
 * cd("/home/user", "..")           → "/home"
 * cd("/", "..")                    → "/"
 * cd("/home/user", "/etc")         → "/etc"
 * cd("/home/user", "./docs/../pics") → "/home/user/pics"
 * <p>
 * TIME TARGET: ~10-15 minutes
 */
public class CdDirectoryP1 {

    /**
     * Resolve newDir relative to currentDir and return the absolute path.
     */
    public String cd(String currentDir, String newDir) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
