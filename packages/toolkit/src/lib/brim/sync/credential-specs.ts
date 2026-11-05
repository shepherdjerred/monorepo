/**
 * Brim sync's registered credentials, spread into the toolkit credential
 * registry. All resolve through the 1Password service account; none is
 * written to disk.
 */

const BRIM_SYNC_S3_ITEM =
  "op://v64ocnykdqju4ui6j6pua56xw4/rruylujuwxetez6pein24mzgm4";
const BRIM_SYNC_AGE_ITEM =
  "op://v64ocnykdqju4ui6j6pua56xw4/7v35e444tdyqnmfwwjz45kivz4";

export const BRIM_SYNC_CREDENTIALS = {
  BRIM_SYNC_S3_ACCESS_KEY_ID: {
    description:
      "Scoped SeaweedFS key for the brim-sessions bucket (brim.sync.s3.credentials = broker)",
    source: { kind: "op", ref: `${BRIM_SYNC_S3_ITEM}/access-key-id` },
  },
  BRIM_SYNC_S3_SECRET_ACCESS_KEY: {
    description:
      "Scoped SeaweedFS secret for the brim-sessions bucket (brim.sync.s3.credentials = broker)",
    source: { kind: "op", ref: `${BRIM_SYNC_S3_ITEM}/secret-access-key` },
  },
  BRIM_SYNC_AGE_IDENTITY: {
    description:
      "age identity that decrypts the Brim sync archive (pull and state adoption only)",
    source: { kind: "op", ref: `${BRIM_SYNC_AGE_ITEM}/credential` },
  },
} as const;
