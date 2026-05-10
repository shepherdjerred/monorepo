---
title: "Palindrome Number"
date: 2024-08-04Z-0700
leetcode: true
---

## Problem

Given an integer x, return true if x is a
palindrome
, and false otherwise.

Example 1:

```text
Input: x = 121
Output: true
Explanation: 121 reads as 121 from left to right and from right to left.
```

Example 2:

```text
Input: x = -121
Output: false
Explanation: From left to right, it reads -121. From right to left, it becomes 121-. Therefore it is not a palindrome.
```

Example 3:

```text
Input: x = 10
Output: false
Explanation: Reads 01 from right to left. Therefore it is not a palindrome.
```

Constraints:

- -231 <= x <= 231 - 1

Follow up: Could you solve it without converting the integer to a string?

## Solution

### Reversing

```java
class Solution {
    public boolean isPalindrome(int x) {
        if (x < 0) {
            return false;
        }

        var copy = x;
        var rev = 0;

        while (copy > 0) {
            rev = (rev * 10) + copy % 10;
            copy = copy / 10;
        }

        while (x > 0 || rev > 0) {
            if (x % 10 != rev % 10) {
                return false;
            }
            x = x / 10;
            rev = rev / 10;
        }

        return x == 0 && rev == 0;
    }
}
```

### Using a Deque

```java
class Solution {
    public boolean isPalindrome(int x) {
        if (x < 0) {
            return false;
        }

        var dq = new LinkedList<Integer>();
        while (x > 0) {
            dq.addLast(x % 10);
            x = x / 10;
        }

        while (dq.size() > 1) {
            if (dq.pollFirst() != dq.pollLast()) {
                return false;
            }
        }

        return true;
    }
}
```
