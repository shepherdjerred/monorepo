---
title: "Power of Three"
date: 2024-07-24Z-0700
leetcode: true
---

## Problem

Given an integer n, return true if it is a power of three. Otherwise, return false.

An integer n is a power of three, if there exists an integer x such that n == 3x.

Example 1:

```text
Input: n = 27
Output: true
Explanation: 27 = 33
```

Example 2:

```text
Input: n = 0
Output: false
Explanation: There is no x where 3x = 0.
```

Example 3:

```text
Input: n = -1
Output: false
Explanation: There is no x where 3x = (-1).
```

Constraints:

- -231 <= n <= 231 - 1

Follow up: Could you solve it without loops/recursion?

## Solution

```java
class Solution {
    public boolean isPowerOfThree(int n) {
        if (n == 0) {
            return false;
        }
        while (n % 3 == 0) {
            n = n / 3;
        }
        return n == 1;
    }
}
```
