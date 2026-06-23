import { describe, it, expect } from "vitest";
import { resolveSocial, isSocialKey, phoneLinks, findSocial } from "@/lib/socials";

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
    expect(resolveSocial("WhatsApp", "+1 (555) 123-4567")!.url).toBe(
      "https://api.whatsapp.com/send?phone=15551234567"
    );
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

describe("findSocial", () => {
  it("finds a Telegram handle under its platform key", () => {
    const found = findSocial({ Telegram: "@PlayStar123", Interests: "coffee" }, "telegram");
    expect(found).not.toBeNull();
    expect(found!.key).toBe("Telegram");
    expect(found!.social.url).toBe("https://t.me/PlayStar123");
  });

  it("finds a platform even under a generic key with a full URL", () => {
    const found = findSocial({ Profile: "https://t.me/PlayStar123" }, "telegram");
    expect(found!.social.platform).toBe("telegram");
  });

  it("returns null when the platform isn't present", () => {
    expect(findSocial({ Instagram: "@meny" }, "telegram")).toBeNull();
    expect(findSocial(null, "telegram")).toBeNull();
    expect(findSocial(undefined, "whatsapp")).toBeNull();
  });
});

describe("phoneLinks", () => {
  it("builds tel: and WhatsApp links, keeping a leading + on tel:", () => {
    const r = phoneLinks("+1 (555) 123-4567");
    expect(r).not.toBeNull();
    expect(r!.tel).toBe("tel:+15551234567");
    expect(r!.whatsapp).toBe("https://api.whatsapp.com/send?phone=15551234567");
  });

  it("omits the + when the number wasn't written with one", () => {
    expect(phoneLinks("555 123 4567")!.tel).toBe("tel:5551234567");
  });

  it("returns null when there aren't enough digits to dial", () => {
    expect(phoneLinks("123")).toBeNull();
    expect(phoneLinks("ext. 42")).toBeNull();
    expect(phoneLinks("")).toBeNull();
  });
});
