package sjer.red;

import java.util.ArrayList;
import java.util.List;

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
