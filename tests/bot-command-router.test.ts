import { describe, expect, it } from "vitest";
import { BotCommandRouter } from "../src/assistant/bot-command-router.js";
import type { AuthorizedUser } from "../src/auth/types.js";
import { createLogger } from "../src/logging/logger.js";
import type { AuditInput, AuditStore } from "../src/messages/audit.repository.js";
import type { AssistantResponder, AssistantResponse } from "../src/assistant/types.js";
import type { AdminWhitelist, AdminWhitelistResult } from "../src/auth/admin-whitelist.service.js";
import type { WhitelistUserInput } from "../src/auth/user-provisioning.js";

class MemoryAudit implements AuditStore {
  events: AuditInput[] = [];
  async record(input: AuditInput): Promise<void> {
    this.events.push(input);
  }
}

class SpyResponder implements AssistantResponder {
  calls = 0;
  async handle(): Promise<AssistantResponse> {
    this.calls += 1;
    return { text: "downstream", resource: null, resources: [], outcome: "success" };
  }
}

function build(defaultLocale: "tr" | "en" = "tr") {
  const audit = new MemoryAudit();
  const next = new SpyResponder();
  const router = new BotCommandRouter(next, { audit, logger: createLogger("silent"), defaultLocale });
  return { audit, next, router };
}

const user: AuthorizedUser = { id: "user-1", department: "Sales", role: "employee" };
const context = { messageId: "message-1" };

describe("bot command router", () => {
  it("answers the privacy notice in the user's locale without auditing", async () => {
    const { audit, next, router } = build("tr");
    const response = await router.handle(user, "gizlilik", context);
    expect(response.text).toContain("Gizlilik");
    expect(next.calls).toBe(0);
    expect(audit.events).toHaveLength(0);
  });

  it("records an audited erasure request and confirms", async () => {
    const { audit, next, router } = build("en");
    const response = await router.handle({ ...user, locale: "en" }, "please delete my data", context);
    expect(response.text.toLowerCase()).toContain("erasure request");
    expect(next.calls).toBe(0);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.eventType).toBe("privacy.erasure_request");
    expect(audit.events[0]?.messageId).toBe("message-1");
  });

  it("records an audited access request and confirms", async () => {
    const { audit, router } = build("tr");
    const response = await router.handle(user, "erişim istiyorum", context);
    expect(response.text).toContain("Erişim");
    expect(audit.events[0]?.eventType).toBe("identity.access_request");
  });

  it("prefers erasure over the generic privacy notice", async () => {
    const { audit, router } = build("tr");
    await router.handle(user, "verilerimi sil lütfen", context);
    expect(audit.events[0]?.eventType).toBe("privacy.erasure_request");
  });

  it("delegates anything unrecognized to the downstream responder", async () => {
    const { next, audit, router } = build();
    const response = await router.handle(user, "satış özeti", context);
    expect(response.text).toBe("downstream");
    expect(next.calls).toBe(1);
    expect(audit.events).toHaveLength(0);
  });
});

class SpyAdminWhitelist implements AdminWhitelist {
  admin: boolean;
  calls: Array<{ actorId: string; input: WhitelistUserInput }> = [];
  constructor(admin: boolean) {
    this.admin = admin;
  }
  async isAdmin(): Promise<boolean> {
    return this.admin;
  }
  async whitelist(actor: { id: string }, input: WhitelistUserInput): Promise<AdminWhitelistResult> {
    this.calls.push({ actorId: actor.id, input });
    return { created: true, role: input.role ?? "employee", name: input.name };
  }
}

function buildWithAdmin(service: AdminWhitelist, defaultLocale: "tr" | "en" = "en") {
  const audit = new MemoryAudit();
  const next = new SpyResponder();
  const router = new BotCommandRouter(next, { audit, logger: createLogger("silent"), defaultLocale, adminWhitelist: service });
  return { audit, next, router };
}

describe("admin whitelist command", () => {
  it("provisions a user when the actor is an admin", async () => {
    const service = new SpyAdminWhitelist(true);
    const { next, router } = buildWithAdmin(service);
    const response = await router.handle(
      user,
      'whitelist +905551112233 name="Ada Lovelace" role=manager',
      context
    );
    expect(service.calls).toHaveLength(1);
    expect(service.calls[0]?.input.phone).toBe("+905551112233");
    expect(service.calls[0]?.input.name).toBe("Ada Lovelace");
    expect(response.text).toContain("Ada Lovelace");
    expect(response.text.toLowerCase()).toContain("added");
    expect(next.calls).toBe(0);
  });

  it("stays invisible and inert for non-admins (falls through, no provisioning, no audit)", async () => {
    const service = new SpyAdminWhitelist(false);
    const { next, audit, router } = buildWithAdmin(service);
    const response = await router.handle(user, "whitelist +905551112233 name=x", context);
    expect(service.calls).toHaveLength(0);
    expect(next.calls).toBe(1);
    expect(response.text).toBe("downstream");
    // Completely inert: nothing recorded, indistinguishable from ordinary text.
    expect(audit.events).toHaveLength(0);
  });

  it("returns usage when an admin omits the phone", async () => {
    const service = new SpyAdminWhitelist(true);
    const { next, router } = buildWithAdmin(service);
    const response = await router.handle(user, 'whitelist name="No Phone"', context);
    expect(service.calls).toHaveLength(0);
    expect(response.text.toLowerCase()).toContain("usage");
    expect(next.calls).toBe(0);
  });

  it("is inert when no admin service is configured", async () => {
    const { next, router } = build();
    const response = await router.handle(user, "whitelist +905551112233 name=x", context);
    expect(next.calls).toBe(1);
    expect(response.text).toBe("downstream");
  });
});
