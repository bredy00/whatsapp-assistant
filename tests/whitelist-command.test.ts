import { describe, expect, it } from "vitest";
import { isWhitelistCommand, parseWhitelistCommand } from "../src/assistant/whitelist-command.js";

describe("whitelist command parsing", () => {
  it("detects the trigger word case-insensitively in tr/en", () => {
    expect(isWhitelistCommand("whitelist +90...")).toBe(true);
    expect(isWhitelistCommand("YETKILENDIR +90...")).toBe(true);
    expect(isWhitelistCommand("Yetkilendir +90...")).toBe(true);
    expect(isWhitelistCommand("satış özeti")).toBe(false);
  });

  it("parses phone plus quoted name and flags", () => {
    const input = parseWhitelistCommand('whitelist +905551112233 name="Ada Lovelace" role=manager dept=Sales locale=en perms=company.sales,company.tasks');
    expect(input).not.toBeNull();
    expect(input!.phone).toBe("+905551112233");
    expect(input!.name).toBe("Ada Lovelace");
    expect(input!.role).toBe("manager");
    expect(input!.department).toBe("Sales");
    expect(input!.locale).toBe("en");
    expect(input!.permissions).toEqual(["company.sales", "company.tasks"]);
  });

  it("accepts Turkish flag aliases", () => {
    const input = parseWhitelistCommand('yetkilendir +905551112233 ad="Grace Hopper" rol=employee dil=tr izin=company.tasks');
    expect(input!.name).toBe("Grace Hopper");
    expect(input!.role).toBe("employee");
    expect(input!.locale).toBe("tr");
    expect(input!.permissions).toEqual(["company.tasks"]);
  });

  it("returns null when the phone is missing", () => {
    expect(parseWhitelistCommand('whitelist name="No Phone"')).toBeNull();
  });

  it("returns null when the trigger word is absent", () => {
    expect(parseWhitelistCommand("+905551112233 name=x")).toBeNull();
  });

  it("leaves name empty when not supplied (validation is deferred)", () => {
    const input = parseWhitelistCommand("whitelist +905551112233");
    expect(input!.phone).toBe("+905551112233");
    expect(input!.name).toBe("");
  });
});
