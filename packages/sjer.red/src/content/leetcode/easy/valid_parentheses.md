---
title: "Valid Parentheses"
date: 2024-07-24Z-0700
leetcode: true
---

## Problem

Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.

An input string is valid if:

- Open brackets must be closed by the same type of brackets.
- Open brackets must be closed in the correct order.
- Every close bracket has a corresponding open bracket of the same type.

Example 1:

```text
Input: s = "()"
Output: true
```

Example 2:

```text
Input: s = "()[]{}"
Output: true
```

Example 3:

```text
Input: s = "(]"
Output: false
```

Constraints:

- 1 <= s.length <= 104
- s consists of parentheses only '()[]{}'.

## Solution

A classic stack problem.

```java
class Solution {
    Stack<Character> st = new Stack<Character>();

    public boolean isValid(String s) {
        for (var c : s.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') {
                st.push(c);
            } else {
                if (st.isEmpty()) {
                    return false;
                }
                var t = st.pop();
                if (c == ')' && t != '(') {
                    return false;
                } else if (c == ']' && t != '[') {
                    return false;
                } else if (c == '}' && t != '{') {
                    return false;
                }
            }
        }
        return st.isEmpty();
    }
}
```
