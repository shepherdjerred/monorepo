---
title: "Rotate String"
date: 2024-08-03Z-0700
leetcode: true
---

## Problem

Given two strings s and goal, return true if and only if s can become goal after some number of shifts on s.

A shift on s consists of moving the leftmost character of s to the rightmost position.

- For example, if s = "abcde", then it will be "bcdea" after one shift.

Example 1:

```text
Input: s = "abcde", goal = "cdeab"
Output: true
```

Example 2:

```text
Input: s = "abcde", goal = "abced"
Output: false
```

Constraints:

- 1 <= s.length, goal.length <= 100
- s and goal consist of lowercase English letters.

## Solution

```java
class Solution {
    public boolean rotateString(String s, String goal) {
        return (s + s).contains(goal);
    }
}
```
