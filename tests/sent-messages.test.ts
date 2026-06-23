import { describe, it, expect } from "vitest"
import { validateSentMessageBody } from "@/lib/validation"

describe("validateSentMessageBody", () => {
  it("accepts valid email method", () => {
    const res = validateSentMessageBody({ contactId: "abc", body: "Hello!", method: "email" })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.contactId).toBe("abc")
      expect(res.data.method).toBe("email")
    }
  })

  it("accepts valid clipboard method", () => {
    const res = validateSentMessageBody({ contactId: "abc", body: "Hello!", method: "clipboard" })
    expect(res.ok).toBe(true)
  })

  it("rejects missing contactId", () => {
    expect(validateSentMessageBody({ body: "Hi", method: "email" }).ok).toBe(false)
  })

  it("rejects empty body", () => {
    expect(validateSentMessageBody({ contactId: "abc", body: "  ", method: "email" }).ok).toBe(false)
  })

  it("rejects invalid method", () => {
    expect(validateSentMessageBody({ contactId: "abc", body: "Hi", method: "fax" }).ok).toBe(false)
  })

  it("rejects non-object input", () => {
    expect(validateSentMessageBody(null).ok).toBe(false)
    expect(validateSentMessageBody("string").ok).toBe(false)
  })
})
