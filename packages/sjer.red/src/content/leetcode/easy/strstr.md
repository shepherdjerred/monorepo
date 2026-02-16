---
title: "Implement strStr()"
date: 2024-06-15Z-0700
leetcode: true
---

## Problem

Given two strings needle and haystack, return the index of the first occurrence of needle in haystack, or -1 if needle is not part of haystack.

Example 1:

```text
Input: haystack = "sadbutsad", needle = "sad"
Output: 0
Explanation: "sad" occurs at index 0 and 6.
The first occurrence is at index 0, so we return 0.
```

Example 2:

```text
Input: haystack = "leetcode", needle = "leeto"
Output: -1
Explanation: "leeto" did not occur in "leetcode", so we return -1.
```

Constraints:

- 1 <= haystack.length, needle.length <= 10^4
- haystack and needle consist of only lowercase English characters.

## Solution

O(n \* m) time complexity.

```java
class Solution {
    public int strStr(String haystack, String needle) {
        for (var h = 0; h <= haystack.length() - needle.length(); h++) {
            var ok = true;
            for (var n = 0; n < needle.length(); n++) {
                var ch = haystack.charAt(h + n);
                var cn = needle.charAt(n);
                if (ch != cn) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                return h;
            }
        }
        return -1;
    }
}
```
