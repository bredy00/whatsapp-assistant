import type { Logger } from "pino";
import type { AuthorizedUser } from "../auth/types.js";
import { PermissionDeniedError } from "../auth/authorization.service.js";
import type { AdminWhitelist, AdminWhitelistResult } from "../auth/admin-whitelist.service.js";
import { logSafe } from "../logging/logger.js";
import type { AuditStore } from "../messages/audit.repository.js";
import { systemMessage, type AssistantLocale } from "./system-messages.js";
import { isWhitelistCommand, parseWhitelistCommand } from "./whitelist-command.js";
import type { AssistantContext, AssistantResponder, AssistantResponse } from "./types.js";

// Locale-insensitive folding matching the report router: dotted/dotless i,
// diacritics and case are normalized so "Verilerimi Sil" == "verilerimi sil".
function fold(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(command: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => command === phrase || command.includes(phrase));
}

// Erasure must be tested before the generic privacy notice because the erasure
// phrases also contain the word "veri"/"data".
const ERASURE_PHRASES = ["verilerimi sil", "verimi sil", "beni sil", "delete my data", "erase my data"] as const;
const PRIVACY_PHRASES = ["gizlilik", "kvkk", "verilerim", "my data", "privacy"] as const;
const ACCESS_PHRASES = ["erisim istiyorum", "erisim talebi", "yetki istiyorum", "request access", "access request"] as const;

type BotCommandRouterOptions = {
  audit: AuditStore;
  logger: Logger;
  defaultLocale: AssistantLocale;
  // Present only when the WhatsApp admin whitelist command is enabled. When
  // absent, "whitelist …" is treated as ordinary text and falls through.
  adminWhitelist?: AdminWhitelist;
};

// Decorates the downstream responder (report router / LLM) with a small set of
// self-service bot commands handled entirely in-process: a privacy notice, a
// right-to-erasure request, and an access request. Anything it does not
// recognize falls through unchanged. It only ever writes audit events, so it
// needs no database privileges beyond what the runtime already holds.
export class BotCommandRouter implements AssistantResponder {
  constructor(
    private readonly next: AssistantResponder,
    private readonly options: BotCommandRouterOptions
  ) {}

  async handle(user: AuthorizedUser, incomingText: string, context: AssistantContext): Promise<AssistantResponse> {
    const command = fold(incomingText);
    const locale = user.locale ?? this.options.defaultLocale;

    if (this.options.adminWhitelist && isWhitelistCommand(incomingText)) {
      const handled = await this.handleWhitelist(user, incomingText, locale, context);
      // null means "not an admin" (or a race) — fall through so the command
      // stays invisible to anyone who cannot use it.
      if (handled) return handled;
    }

    if (matchesAny(command, ERASURE_PHRASES)) {
      await this.record(user.id, "privacy.erasure_request", context.messageId);
      return this.reply(systemMessage("erasureRequested", locale));
    }
    if (matchesAny(command, PRIVACY_PHRASES)) {
      return this.reply(systemMessage("privacyInfo", locale));
    }
    if (matchesAny(command, ACCESS_PHRASES)) {
      await this.record(user.id, "identity.access_request", context.messageId);
      return this.reply(systemMessage("accessRequested", locale));
    }

    return this.next.handle(user, incomingText, context);
  }

  private reply(text: string): AssistantResponse {
    return { text, resource: null, resources: [], outcome: "success" };
  }

  // Returns a response only when the actor is an admin; otherwise null so the
  // caller falls through and the command reveals nothing to non-admins.
  private async handleWhitelist(
    actor: AuthorizedUser,
    incomingText: string,
    locale: AssistantLocale,
    context: AssistantContext
  ): Promise<AssistantResponse | null> {
    const service = this.options.adminWhitelist;
    if (!service) return null;
    if (!(await service.isAdmin(actor))) {
      // Bounded by the upstream per-user rate limit; useful security signal.
      await this.record(actor.id, "identity.whitelist_denied", context.messageId).catch(() => undefined);
      return null;
    }
    const input = parseWhitelistCommand(incomingText);
    if (!input) return this.reply(systemMessage("whitelistUsage", locale));
    try {
      const result = await service.whitelist(actor, input);
      return this.reply(this.whitelistConfirmation(result, locale));
    } catch (error) {
      if (error instanceof PermissionDeniedError) return null;
      logSafe(this.options.logger, "warn", { error, actorId: actor.id }, "Admin whitelist command rejected");
      const detail = error instanceof Error ? error.message : "invalid input";
      return this.reply(`${systemMessage("whitelistUsage", locale)}\n(${detail})`);
    }
  }

  private whitelistConfirmation(result: AdminWhitelistResult, locale: AssistantLocale): string {
    if (locale === "tr") {
      return `${result.name} ${result.created ? "eklendi" : "güncellendi"} (rol: ${result.role}).`;
    }
    return `${result.name} ${result.created ? "added" : "updated"} (role: ${result.role}).`;
  }

  // Best-effort intake record. A failed audit write must not deny the user the
  // confirmation — the request itself is idempotent and can be re-sent — so the
  // error is logged and swallowed.
  private async record(userId: string, eventType: string, messageId: string): Promise<void> {
    try {
      await this.options.audit.record({
        userId,
        eventType,
        outcome: "success",
        messageId,
        details: { channel: "whatsapp" }
      });
    } catch (error) {
      logSafe(this.options.logger, "error", { error, userId, eventType }, "Self-service request could not be audited");
    }
  }
}
