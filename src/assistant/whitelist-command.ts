import type { WhitelistUserInput } from "../auth/user-provisioning.js";

// Trigger words for the admin whitelist command (English + Turkish). Matched
// against the first word only, after folding.
export const WHITELIST_TRIGGERS = new Set(["whitelist", "yetkilendir"]);

// Turkish locale-aware lowercasing maps capital I to the dotless ı, so
// "YETKILENDIR" would not equal "yetkilendir". Fold the dotless ı back to i so
// ASCII command keywords/keys match regardless of how they were typed.
function foldKeyword(value: string): string {
  return value.toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
}

export function isWhitelistCommand(text: string): boolean {
  const firstWord = text.trim().split(/\s+/, 1)[0] ?? "";
  return WHITELIST_TRIGGERS.has(foldKeyword(firstWord));
}

// Splits on whitespace but keeps double-quoted spans together (and strips the
// quotes), so a name with spaces can be passed as name="Ada Lovelace".
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let hasContent = false;
  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
      hasContent = true;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      if (hasContent) tokens.push(current);
      current = "";
      hasContent = false;
    } else {
      current += char;
      hasContent = true;
    }
  }
  if (hasContent) tokens.push(current);
  return tokens;
}

// Parses `whitelist <phone> name="Ada" role=employee dept=Sales locale=tr
// perms=company.sales,company.tasks`. Returns null when the command word or
// the phone (the first bare, non key=value token) is missing. Field validation
// (phone format, name length, role/permission whitelisting) is deferred to
// normalizeWhitelistUser so there is a single source of truth.
export function parseWhitelistCommand(text: string): WhitelistUserInput | null {
  const tokens = tokenize(text.trim());
  const keyword = tokens.shift();
  if (!keyword || !WHITELIST_TRIGGERS.has(foldKeyword(keyword))) return null;

  let phone: string | null = null;
  let name = "";
  let role: string | undefined;
  let department: string | undefined;
  let locale: string | undefined;
  let permissions: string[] | undefined;

  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq <= 0) {
      // First bare token is the phone number; ignore any extras.
      if (phone === null) phone = token;
      continue;
    }
    const key = foldKeyword(token.slice(0, eq));
    const value = token.slice(eq + 1);
    switch (key) {
      case "name":
      case "isim":
      case "ad":
        name = value;
        break;
      case "role":
      case "rol":
        role = value;
        break;
      case "dept":
      case "department":
      case "departman":
        department = value;
        break;
      case "locale":
      case "dil":
        locale = value;
        break;
      case "perms":
      case "permissions":
      case "izin":
      case "izinler":
        permissions = value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean);
        break;
      default:
        // Unknown key=token is ignored so a stray flag never blocks onboarding.
        break;
    }
  }

  if (phone === null) return null;
  return {
    phone,
    name,
    ...(department !== undefined ? { department } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(locale !== undefined ? { locale } : {}),
    ...(permissions !== undefined ? { permissions } : {})
  };
}
