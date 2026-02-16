---
title: "Reverse Integer"
date: 2024-06-15Z-0700
leetcode: true
---

## Problem

Given a signed 32-bit integer x, return x with its digits reversed. If reversing x causes the value to go outside the signed 32-bit integer range [-2^31, 2^31 - 1], then return 0.

Assume the environment does not allow you to store 64-bit integers (signed or unsigned).

Example 1:

```text
Input: x = 123
Output: 321
```

Example 2:

```text
Input: x = -123
Output: -321
```

Example 3:

```text
Input: x = 120
Output: 21
```

Constraints:

- -2^31 <= x <= 2^31 - 1

## Solution

This is so ugly.

```java
class Solution {
    public int reverse(int x) {
        if (x == 0) {
            return 0;
        }
        var s = "";
        boolean isNegative = x < 0;
        if (isNegative) {
            x *= -1;
            s = "-";
        }
        while (x > 0) {
            var next = x % 10;
            s = s + String.valueOf(next);
            x = x / 10;
        }
        try {
            x = Integer.parseInt(s);
            return x;
        } catch (Exception e) {
            return 0;
        }
    }
}
```
