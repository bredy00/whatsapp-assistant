import type { Pool } from "pg";
import type { CountryCode } from "libphonenumber-js";
import type { AuthorizationService } from "./authorization.service.js";
import { appendAuditEvent } from "../messages/audit.repository.js";
import {
  normalizeWhitelistUser,
  upsertWhitelistedUser,
  type WhitelistCrypto,
  type WhitelistUserInput
} from "./user-provisioning.js";
import type { AuthorizedUser } from "./types.js";

// Permission an actor must hold (action "write") to onboard users from the
// WhatsApp admin command. Distinct from the report resources so granting it is
// a deliberate, separate act.
export const ADMIN_WHITELIST_RESOURCE = "admin.whitelist";

export type AdminWhitelistResult = { created: boolean; role: string; name: string };

// The capability the bot-command-router depends on. Kept as an interface so the
// router can be exercised with a fake in tests without a live database.
export interface AdminWhitelist {
  isAdmin(actor: AuthorizedUser): Promise<boolean>;
  whitelist(actor: AuthorizedUser, input: WhitelistUserInput): Promise<AdminWhitelistResult>;
}

type AdminWhitelistOptions = {
  pool: Pool;
  crypto: WhitelistCrypto;
  authorization: AuthorizationService;
  defaultCountry: CountryCode;
};

// Runtime user provisioning for admins. Every write is permission-gated and
// runs in a single transaction that also records who performed it, so a
// compromised or mistaken command is both blocked and fully attributable.
export class AdminWhitelistService implements AdminWhitelist {
  constructor(private readonly options: AdminWhitelistOptions) {}

  async isAdmin(actor: AuthorizedUser): Promise<boolean> {
    return this.options.authorization.isAllowed(actor.id, ADMIN_WHITELIST_RESOURCE, "write");
  }

  async whitelist(actor: AuthorizedUser, input: WhitelistUserInput): Promise<AdminWhitelistResult> {
    // Defense in depth: re-check permission here even though the router only
    // calls this for admins, so the write can never happen unauthorized.
    await this.options.authorization.require(actor.id, ADMIN_WHITELIST_RESOURCE, "write");
    const normalized = normalizeWhitelistUser(input, this.options.defaultCountry);

    const client = await this.options.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await upsertWhitelistedUser(client, this.options.crypto, normalized);
      // Ties the change to the actor without storing any recipient PII; the
      // recipient's own identity.whitelist_update is written inside the upsert.
      await appendAuditEvent(client, this.options.crypto.auditIntegrity, {
        userId: actor.id,
        eventType: "identity.whitelist_admin_action",
        outcome: "success",
        details: { targetCreated: result.created, role: normalized.role, channel: "whatsapp" }
      });
      await client.query("COMMIT");
      return { created: result.created, role: normalized.role, name: normalized.name };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
