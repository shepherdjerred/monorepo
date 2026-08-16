/** Authorization for guild-level karma configuration. */
export function canConfigureKarma(params: {
  userId: string;
  adminUserId: string;
  hasManageGuild: boolean;
}): boolean {
  return params.hasManageGuild || params.userId === params.adminUserId;
}
