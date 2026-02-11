---
title: "Generate Parentheses"
date: 2024-07-28Z-0700
leetcode: true
---

## Problem

Given n pairs of parentheses, write a function to generate all combinations of well-formed parentheses.

Example 1:

```text
Input: n = 3
Output: ["((()))","(()())","(())()","()(())","()()()"]
```

Example 2:

```text
Input: n = 1
Output: ["()"]
```

Constraints:

- 1 <= n <= 8

## Solution

Backtracking is actually super fun.

```java
class Solution {
    public List<String> generateParenthesis(int n) {
        var answers = new ArrayList<String>();
        solve(n, 0, "", answers);
        return answers;
    }

    public void solve(int n, int depth, String current, List<String> answers) {
        // at each point, we can choose to nest or not.
        if (n == 0) {
            // close out this depth
            for (int i = 0; i < depth; i++) {
                current = current + ")";
            }

            answers.add(current);
            return;
        }

        // nest
        solve(n - 1, depth + 1, current + "(", answers);

        // close out
        for (int i = 1; i < depth + 1; i++) {
            current = current + ")";
            solve(n - 1, depth - i + 1, current + "(", answers);
        }
    }
}
```
