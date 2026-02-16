---
title: "Valid Palindrome"
date: 2024-06-15Z-0700
leetcode: true
---

## Problem

A phrase is a palindrome if, after converting all uppercase letters into lowercase letters and removing all non-alphanumeric characters, it reads the same forward and backward. Alphanumeric characters include letters and numbers.

Given a string s, return true if it is a palindrome, or false otherwise.

Example 1:

```text
Input: s = "A man, a plan, a canal: Panama"
Output: true
Explanation: "amanaplanacanalpanama" is a palindrome.
```

Example 2:

```text
Input: s = "race a car"
Output: false
Explanation: "raceacar" is not a palindrome.
```

Example 3:

```text
Input: s = " "
Output: true
Explanation: s is an empty string "" after removing non-alphanumeric characters.
Since an empty string reads the same forward and backward, it is a palindrome.
```

Constraints:

- 1 <= s.length <= 2 \* 10^5
- s consists only of printable ASCII characters.

## Solution

This is a classic problem that uses a stack as the solution. Who hasn't written such an algorithm?

O(n) time, O(n) space.

There is an O(1) space algorithm that doesn't use a stack. You could use two pointers to check.

```java
class Solution {
    public boolean isPalindrome(String s) {
        s = s.toLowerCase();
        var stack = new Stack<Character>();

        for (var c : s.toCharArray()) {
            var i = (int) c;
            if ((i >= 97 && i <= 122) || (i >= 48) && (i <= 57)) {
                stack.push(c);
            }
        }

        for (var c : s.toCharArray()) {
            var i = (int) c;
            if ((i >= 97 && i <= 122) || (i >= 48) && (i <= 57)) {
                var result = stack.pop();
                if (!result.equals(c)) {
                    return false;
                }
            }
        }

        return true;
    }
}
```
