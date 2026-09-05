import Foundation

public enum CodeFillConfiguration {
    public static let applicationGroupIdentifier = "63ZAG7X889.com.sjerred.MailMateCodeFill"
    public static let recordLifetime: TimeInterval = 180
    public static let brokerRequestFileName = ".broker-reconciliation-request"
    public static let recordsDidChangeNotification = Notification.Name("com.sjerred.MailMateCodeFill.recordsDidChange")
}
