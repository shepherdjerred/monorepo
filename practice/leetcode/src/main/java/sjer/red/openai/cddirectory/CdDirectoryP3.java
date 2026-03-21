package sjer.red.openai.cddirectory;

import java.util.*;

/**
 * PROBLEM: cd (Change Directory)
 * <p>
 * PART 3: Symbolic Link Support
 * - cd(currentDir, newDir, homeDir, symlinks) — resolve symbolic links
 * - After resolving the path, check if it matches any symlink source
 * - Use longest-match: if both "/usr" and "/usr/local/bin" are symlinks,
 * prefer "/usr/local/bin" for path "/usr/local/bin/foo"
 * - Detect symlink cycles and throw IllegalArgumentException
 * - Symlinks only apply to the final resolved path (not during resolution)
 * <p>
 * Examples:
 * cd("/home", "/usr/bin", "/home/default", {"/usr/bin"→"/opt/bin"})
 * → "/opt/bin"
 * cd("/", "/usr/local/bin", "/home/default",
 * {"/usr/local/bin"→"/opt/local/bin", "/usr"→"/system/usr"})
 * → "/opt/local/bin"  (longest match wins)
 * cd("/", "/a", "/home/default", {"/a"→"/b", "/b"→"/a"})
 * → throws IllegalArgumentException (cycle detected)
 * <p>
 * TIME TARGET: ~15 minutes (cumulative ~35-40 minutes)
 */
public class CdDirectoryP3 {

    /**
     * Resolve newDir relative to currentDir with home directory expansion and symbolic link resolution.
     * Uses longest-match for symlink sources. Detects cycles.
     */
    public String cd(String currentDir, String newDir, String homeDir, Map<String, String> symlinks) {
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

        String resolved;

        // would be nice if we could get rid of this condition
        if (stack.size() < 2) {
            resolved = "/";
        } else {
            resolved = String.join("/", stack);
        }

        System.out.format("%s\n", resolved);


        // symlink resolution

        /*
         * PART 3: Symbolic Link Support
         * - Use longest-match: if both "/usr" and "/usr/local/bin" are symlinks,
         *   prefer "/usr/local/bin" for path "/usr/local/bin/foo"
         * - Detect symlink cycles and throw IllegalArgumentException
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
         */

        /*
         * 1. get list of keys
         * 2. sort keys by length desc
         * 3a. iterate -- does this key match my current value? keep a `seen` set
         * 3b. alternative, maybe faster -- split path by segment (start large -> small) and lookup in map
         * 4. if a match is in `seen`, skip, or remove from symlinks altogether. is there ever a reason to revisit
         * actually, if there's a cycle, there's no way to resolve that, right? it's an error.
         */

        var seen = new HashSet<String>();

        // we have two vars:
        // resolved, which is our current best match
        // candidate, which is what we're trying to match against next
        var candidate = resolved;

        // we keep going as long as candidate is not empty
        while (!candidate.isEmpty()) {
            // we're in a loop
            // not 100% sure this is the correct place
            if (seen.contains(candidate)) {
                throw new IllegalArgumentException();
            }

            if (symlinks.containsKey(candidate)) {
                // match!
                // never re-evaluate
                seen.add(candidate);
                // update references so we now have our best match
                resolved = symlinks.get(candidate);
                candidate = symlinks.get(candidate);
            } else {
                // no match!
                // go up and see if we can get a looser match
                var resolvedParts = new ArrayList<>(Arrays.asList(candidate.split("/")));
                if (resolvedParts.isEmpty()) {
                    break;
                }
                resolvedParts.removeLast();
                candidate = String.join("/", resolvedParts);
            }
        }

        /*
         * /usr/bin -> /home/jerred/usr/bin
         * /home/jerred/usr/bin -> /my/bin
         * /my/bin -> /usr/bin <-- why would we ever want to follow this
         */

        return resolved;
    }
}
