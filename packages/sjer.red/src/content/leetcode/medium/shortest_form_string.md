---
title: "Shortest Way to Form String"
date: 2024-08-12Z-0700
leetcode: true
---

## Problem

A subsequence of a string is a new string that is formed from the original string by deleting some (can be none) of the characters without disturbing the relative positions of the remaining characters. (i.e., "ace" is a subsequence of "abcde" while "aec" is not).

Given two strings source and target, return the minimum number of subsequences of source such that their concatenation equals target. If the task is impossible, return -1.

Example 1:

```text
Input: source = "abc", target = "abcbc"
Output: 2
Explanation: The target "abcbc" can be formed by "abc" and "bc", which are subsequences of source "abc".
```

Example 2:

```text
Input: source = "abc", target = "acdbc"
Output: -1
Explanation: The target string cannot be constructed from the subsequences of source string due to the character "d" in target string.
```

Example 3:

```text
Input: source = "xyz", target = "xzyxz"
Output: 3
Explanation: The target string can be constructed as follows "xz" + "y" + "xz".
```

Constraints:

- 1 <= source.length, target.length <= 1000
- source and target consist of lowercase English letters.

## Solution

```java
class Solution {
    public int shortestWay(String source, String target) {
        var sourceIdx = 0;
        var targetIdx = 0;
        var times = 1;
        var ok = false;

        while (targetIdx < target.length()) {
            // loop around
            if (sourceIdx == source.length()) {
                if (!ok) {
                    return -1;
                }
                sourceIdx = 0;
                times += 1;
                ok = false;
            }

            // read in character-by-character from source
            if (source.charAt(sourceIdx) == target.charAt(targetIdx)) {
                targetIdx += 1;
                ok = true;
            }
            // always increment
            // we either consume the character or can't use it
            sourceIdx += 1;
        }

        return times;
    }
}
```
