---
title: "Reverse String"
date: 2024-06-15Z-0700
leetcode: true
---

## Problem

Write a function that reverses a string. The input string is given as an array of characters s.

You must do this by modifying the input array in-place with O(1) extra memory.

Example 1:

```text
Input: s = ["h","e","l","l","o"]
Output: ["o","l","l","e","h"]
```

Example 2:

```text
Input: s = ["H","a","n","n","a","h"]
Output: ["h","a","n","n","a","H"]
```

Constraints:

- 1 <= s.length <= 10^5
- s[i] is a printable ascii character.

## Solution

```java
class Solution {
    public void reverseString(char[] s) {
        for (var i = 0; i < (int) Math.floor(s.length / 2); i++) {
            var dst = s.length - 1 - i;
            var tmp = s[i];
            s[i] = s[dst];
            s[dst] = tmp;
        }
    }
}
```
