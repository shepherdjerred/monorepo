-- Claim the "first subscription" milestone durably per installation, mirroring
-- firstCoreOutputAt. Deriving "is this the first subscription?" from the
-- current subscription count re-fires when a guild deletes its last
-- subscription and later adds another: the count is zero again, so both the
-- Discord and web callers would emit a second first_subscription_created for
-- the same analyticsInstallationId and inflate the install funnel.
ALTER TABLE "GuildInstall" ADD COLUMN "firstSubscriptionAt" DATETIME;
