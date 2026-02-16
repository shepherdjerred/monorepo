---
title: "Simplified Expression Add Operators"
date: 2024-07-29Z-0700
leetcode: true
---

## Problem

Given a string num that contains only digits and an integer target, return all possibilities to insert the binary operators '+', '-', and/or '\*' between the digits of num so that the resultant expression evaluates to the target value.

Note that operands in the returned expressions should not contain leading zeros.

Example 1:

```text
Input: num = "123", target = 6
Output: ["1*2*3","1+2+3"]
Explanation: Both "1*2*3" and "1+2+3" evaluate to 6.
```

Example 2:

```text
Input: num = "232", target = 8
Output: ["2*3+2","2+3*2"]
Explanation: Both "2*3+2" and "2+3*2" evaluate to 8.
```

Example 3:

```text
Input: num = "3456237490", target = 9191
Output: []
Explanation: There are no expressions that can be created from "3456237490" to evaluate to 9191.
```

Constraints:

- 1 <= num.length <= 10
- num consists of only digits.
- -231 <= target <= 231 - 1

## Solution

### Simplification

This is a simplified version of Expression Add Operators. I've relaxed the requirements to only require the `+` and `-` operators, and `0` is not a valid digit.

```java
public class ExpressionAddOperators {
  public static void main(String[] args) {
    System.out.println(solve(new int[]{1, 2, 3}, 6));
    System.out.println(solve(new int[]{1, 2, 3, 4}, 6));
    System.out.println(solve(new int[]{1, 2, 3, 4}, 119));
    System.out.println(solve(new int[]{1, 2, 3, 4}, 46));
  }

  public static List<String> solve(int[] nums, int target) {
    var ans = new ArrayList<String>();
    solve(nums, target, 0, 0, 0, "", ans);
    return ans;
  }

  public static void solve(int[] nums,
                           int target,
                           int index,
                           int evaluatedValue,
                           int operand,
                           String currExpr,
                           List<String> ans) {
    if (index == nums.length) {
      if (evaluatedValue == target && operand == 0) {
        ans.add(currExpr.substring(1));
      }
      return;
    }

    operand = operand * 10;
    operand = operand + nums[index];
    solve(nums, target, index + 1, evaluatedValue, operand, currExpr, ans);

    solve(nums, target, index + 1, evaluatedValue + operand, 0, currExpr + String.format("+%s", operand), ans);

    // not allowed
    if (!currExpr.isEmpty()) {
      solve(nums, target, index + 1, evaluatedValue - operand, 0, currExpr + String.format("-%s", operand), ans);
    }
  }
}
```
