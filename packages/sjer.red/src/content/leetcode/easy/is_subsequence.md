---
title: "Is Subsequence"
date: 2024-07-26Z-0700
leetcode: true
---

## Problem

Given two strings s and t, return true if s is a subsequence of t, or false otherwise.

A subsequence of a string is a new string that is formed from the original string by deleting some (can be none) of the characters without disturbing the relative positions of the remaining characters. (i.e., "ace" is a subsequence of "abcde" while "aec" is not).

Example 1:

```text
Input: s = "abc", t = "ahbgdc"
Output: true
```

Example 2:

```text
Input: s = "axc", t = "ahbgdc"
Output: false
```

Constraints:

- 0 <= s.length <= 100
- 0 <= t.length <= 104
- s and t consist only of lowercase English letters.

Follow up: Suppose there are lots of incoming s, say s1, s2, ..., sk where k >= 109, and you want to check one by one to see if t has its subsequence. In this scenario, how would you change your code?

## Solution

```java
class Solution {
    public boolean isSubsequence(String s, String t) {
        var t_i = 0;
        for (var s_c : s.toCharArray()) {
            var found = false;
            while (t_i < t.length()) {
                if (s_c == t.charAt(t_i)) {
                    found = true;
                }
                t_i += 1;
                if (found) {
                    break;
                }
            }
            if (!found) {
                return false;
            }
        }
        return true;
    }
}
```
