import { describe, it, expect } from "vitest";
import { resolveSocial, isSocialKey } from "@/lib/socials";

describe("resolveSocial", () => {
  it("builds a Telegram link from a handle (the business-card case)", () => {
    const r = resolveSocial("Telegram", "@PlayStar123");
    expect(r).not.toBeNull();
    expect(r!.platform).toBe("telegram");
    expect(r!.url).toBe("https://t.me/PlayStar123");
    expect(r!.handle).toBe("@PlayStar123");
  });

  it("strips a leading @ and trims", () => {
    expect(resolveSocial("Instagram", "  @meny ")!.url).toBe("https://instagram.com/meny");
  });

  it("infers the platform from a full URL even under a generic key", () => {
    const r = resolveSocial("Profile", "https://t.me/PlayStar123");
    expect(r!.platform).toBe("telegram");
    expect(r!.url).toBe("https://t.me/PlayStar123");
  });

  it("keeps an existing profile URL for LinkedIn", () => {
    const r = resolveSocial("LinkedIn", "https://www.linkedin.com/in/meny-monka");
    expect(r!.platform).toBe("linkedin");
    expect(r!.url).toBe("https://www.linkedin.com/in/meny-monka");
  });

  it("maps X/Twitter aliases", () => {
    expect(resolveSocial("X", "meny")!.url).toBe("https://x.com/meny");
    expect(resolveSocial("Twitter", "meny")!.platform).toBe("x");
  });

  it("uses digits only for WhatsApp", () => {
    expect(resolveSocial("WhatsApp", "+1 (555) 123-4567")!.url).toBe("https://wa.me/15551234567");
  });

  it("adds a scheme to a bare website", () => {
    expect(resolveSocial("Website", "playstarmedia.com")!.url).toBe("https://playstarmedia.com");
  });

  it("returns null for non-social fields and empty values", () => {
    expect(resolveSocial("Interests", "coffee, books")).toBeNull();
    expect(resolveSocial("Education", "Ono Academic College")).toBeNull();
    expect(resolveSocial("Telegram", "")).toBeNull();
  });
});

describe("isSocialKey", () => {
  it("recognizes platform keys", () => {
    expect(isSocialKey("Telegram")).toBe(true);
    expect(isSocialKey("LinkedIn")).toBe(true);
    expect(isSocialKey("Website")).toBe(true);
  });
  it("rejects non-social keys (so web enrichment can still add them)", () => {
    expect(isSocialKey("Occupation")).toBe(false);
    expect(isSocialKey("Education")).toBe(false);
  });
});
