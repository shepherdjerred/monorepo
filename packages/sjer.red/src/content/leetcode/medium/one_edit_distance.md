---
title: "One Edit Distance"
date: 2024-07-28Z-0700
leetcode: true
---

## Problem

Given two strings s and t, return true if they are both one edit distance apart, otherwise return false.

A string s is said to be one distance apart from a string t if you can:

- Insert exactly one character into s to get t.
- Delete exactly one character from s to get t.
- Replace exactly one character of s with a different character to get t.

Example 1:

```text
Input: s = "ab", t = "acb"
Output: true
Explanation: We can insert 'c' into s to get t.
```

Example 2:

```text
Input: s = "", t = ""
Output: false
Explanation: We cannot get t from s by only one step.
```

Constraints:

- 0 <= s.length, t.length <= 104
- s and t consist of lowercase letters, uppercase letters, and digits.

## Solution

I am... unsure how this is categorized as sliding window.

This works due to the properties of the question.

- We know that the max difference in length between the two inputs can be at most one
- We know that once we find a single difference, there must be no further differences
- We know that if there are no differences in the string up to the shortest length, then one string must be longer
- If any of the above are untrue, then the inputs are _not_ one edit distance away.

```java
class Solution {
    public boolean isOneEditDistance(String s, String t) {
        // always have s be larger
        if (t.length() > s.length()) {
            return isOneEditDistance(t, s);
        }

        if (s.length() - t.length() > 1) {
            return false;
        }

        for (var i = 0; i < t.length(); i++) {
            if (s.charAt(i) != t.charAt(i)) {
                if (s.length() == t.length()) {
                    return s.substring(i + 1).equals(t.substring(i + 1));
                } else {
                    return s.substring(i + 1).equals(t.substring(i));
                }
            }
        }

        return s.length() == t.length() + 1;
    }
}
```
