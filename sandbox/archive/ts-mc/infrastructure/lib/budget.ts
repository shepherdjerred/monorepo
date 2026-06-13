import { Stack } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { EMAIL } from "./constants";

export function createBudgets(stack: Stack): void {
  new CfnBudget(stack, "Budget", {
    budget: {
      timeUnit: "MONTHLY",
      budgetType: "COST",
      budgetLimit: {
        amount: 20,
        unit: "USD",
      },
      budgetName: "Monthly spending budget",
    },
    notificationsWithSubscribers: [
      {
        notification: {
          comparisonOperator: "GREATER_THAN",
          notificationType: "ACTUAL",
          threshold: 50,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [
          {
            address: EMAIL,
            subscriptionType: "EMAIL",
          },
        ],
      },
      {
        notification: {
          comparisonOperator: "GREATER_THAN",
          notificationType: "FORECASTED",
          threshold: 100,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [
          {
            address: EMAIL,
            subscriptionType: "EMAIL",
          },
        ],
      },
    ],
  });
}
