import { Stack } from "aws-cdk-lib";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { EMAIL } from "./constants";

export default function createEmailNotificationSnsTopic(stack: Stack): Topic {
  const topic = new Topic(stack, "EmailNotificationTopic", {
    displayName: "EmailNotifications",
  });

  topic.addSubscription(new EmailSubscription(EMAIL));

  return topic;
}
