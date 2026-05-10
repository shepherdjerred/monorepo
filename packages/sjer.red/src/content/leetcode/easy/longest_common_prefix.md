---
title: "Longest Common Prefix"
date: 2024-06-15Z-0700
leetcode: true
---

## Problem

Write a function to find the longest common prefix string amongst an array of strings.

If there is no common prefix, return an empty string "".

Example 1:

```text
Input: strs = ["flower","flow","flight"]
Output: "fl"
```

Example 2:

```text
Input: strs = ["dog","racecar","car"]
Output: ""
Explanation: There is no common prefix among the input strings.
```

Constraints:

1 <= strs.length <= 200
0 <= strs[i].length <= 200
strs[i] consists of only lowercase English letters.

## Solution

O(min(n) \* n)

```java
class Solution {
    public String longestCommonPrefix(String[] strs) {
        var prefix = "";

        // find the min now to make our code ahead a bit simpler
        var min = Integer.MAX_VALUE;
        for (var s : strs) {
            min = Math.min(min, s.length());
        }


        for (var i = 0; i < min; i++) {
            // strs will always have at least one item, so this will never be out of bounds
            var target = strs[0].charAt(i);
            for (var s : strs) {
                if (s.charAt(i) != target) {
                    return prefix;
                }
            }
            prefix += target;
        }

        return prefix;
    }
}
```
