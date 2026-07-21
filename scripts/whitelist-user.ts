// The shared whitelist upsert now lives in the runtime tree so both the CLIs
// and the in-band WhatsApp admin command use one implementation. This module
// is kept as a thin re-export so existing script imports keep working.
export {
  normalizeWhitelistUser,
  upsertWhitelistedUser,
  type WhitelistUserInput,
  type NormalizedWhitelistUser,
  type WhitelistCrypto
} from "../src/auth/user-provisioning.js";
