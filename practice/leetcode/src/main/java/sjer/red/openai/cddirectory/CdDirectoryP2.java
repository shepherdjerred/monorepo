package sjer.red.openai.cddirectory;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Stack;

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

    public String cd(String currentDir, String newDir,  String homeDir) {
        var currentParts = Arrays.asList(currentDir.split("/"));
        var newParts = new ArrayList<>(Arrays.asList(newDir.split("/")));
        var homeParts = Arrays.asList(homeDir.split("/"));

        // keeps track of resolved path
        var stack = new Stack<String>();

        // first, seed the stack IFF `newDir` is not abs
        switch (newDir.charAt(0)) {
            case '/' -> {
                // noop
            }
            case '~' -> {
                newParts.removeFirst();
                stack.addAll(homeParts);
            }
            default -> {
                stack.addAll(currentParts);
            }
        }

        // note: ideally we'd have an existence + permission check at each step
        for (String part : newParts) {
            switch (part) {
                case "." -> {
                    // noop
                }
                case ".." -> {
                    // match the behavior of real `cd`
                    // .. at root means nothing happens
                    if (stack.isEmpty()) {
                        // noop
                    } else {
                        stack.pop();
                    }
                }
                default -> stack.push(part);
            }
        }

        // at this point we are done. we know that we have a _somewhat_ valid path

        // would be nice if we could get rid of this condition
        if (stack.size() < 2) {
            return "/";
        } else {
            return String.join("/", stack);
        }
    }
}
