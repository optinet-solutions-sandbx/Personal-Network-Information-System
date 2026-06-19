import type { Contact, InsightItem, InsightPriority } from "./types"
import { computeUpcomingBirthdays } from "./birthdays"

const BIRTHDAY_CAP = 5
const FOLLOW_UP_CAP = 5
const INTRO_CAP = 3
const ENRICHMENT_CAP = 5
const CADENCE_DUE_CAP = 5
const MAX_GROUP_SIZE = 20

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  annually: 365,
}

function cadenceDaysFor(c: Contact): number | null {
  if (!c.followUpCadence) return null
  if (c.followUpCadence === "custom") return c.followUpCadenceDays ?? null
  return CADENCE_DAYS[c.followUpCadence] ?? null
}

function computeCadenceDue(contacts: Contact[], now: Date): InsightItem[] {
  const due: Array<{ contact: Contact; daysOverdue: number }> = []

  for (const c of contacts) {
    const cadDays = cadenceDaysFor(c)
    if (cadDays == null) continue

    const lastNoteAt = c.healthInputs?.lastNoteAt
    const daysSinceLast = lastNoteAt
      ? Math.floor((now.getTime() - new Date(lastNoteAt).getTime()) / (24 * 60 * 60 * 1000))
      : 99999

    if (daysSinceLast >= cadDays) {
      due.push({ contact: c, daysOverdue: Math.max(0, daysSinceLast - cadDays) })
    }
  }

  return due
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, CADENCE_DUE_CAP)
    .map(({ contact, daysOverdue }) => {
      const noNotes = !contact.healthInputs?.lastNoteAt
      const msg = noNotes
        ? `${contact.name} — no notes yet, time to reach out`
        : daysOverdue === 0
        ? `${contact.name} — due for a follow-up today`
        : `${contact.name} — overdue by ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`
      return {
        type: "cadence_due" as const,
        priority: 2 as const,
        contactId: contact.id,
        contactName: contact.name,
        message: msg,
        actionUrl: `/contacts/${contact.id}`,
        draftable: true,
      }
    })
}

export function computeInsights(contacts: Contact[], now: Date = new Date()): InsightItem[] {
  const items: InsightItem[] = []

  // Birthdays within 30 days
  for (const b of computeUpcomingBirthdays(contacts, 30, now).slice(0, BIRTHDAY_CAP)) {
    const priority: InsightPriority = b.daysUntil <= 7 ? 1 : 3
    let msg: string
    if (b.daysUntil === 0) msg = `${b.contact.name}'s birthday is today!`
    else if (b.daysUntil === 1) msg = `${b.contact.name}'s birthday is tomorrow`
    else msg = `${b.contact.name}'s birthday is in ${b.daysUntil} days`
    if (b.turningAge != null) msg += ` — turning ${b.turningAge}`
    items.push({
      type: "birthday",
      priority,
      contactId: b.contact.id,
      contactName: b.contact.name,
      message: msg,
      actionUrl: `/contacts/${b.contact.id}`,
      daysUntil: b.daysUntil,
    })
  }

  // Cadence-based follow-ups (explicit schedule set by the user)
  for (const item of computeCadenceDue(contacts, now)) {
    items.push(item)
  }

  // Follow-ups: Dormant (priority 1) then Fading (priority 2), sorted worst-first
  const needsFollowUp = contacts
    .filter((c) => c.healthTier === "Dormant" || c.healthTier === "Fading")
    .sort((a, b) => {
      if (a.healthTier !== b.healthTier) return a.healthTier === "Dormant" ? -1 : 1
      return (a.healthScore ?? 0) - (b.healthScore ?? 0)
    })
    .slice(0, FOLLOW_UP_CAP)

  for (const c of needsFollowUp) {
    const priority: InsightPriority = c.healthTier === "Dormant" ? 1 : 2
    const msg =
      c.healthTier === "Dormant"
        ? `${c.name} — no recent activity. Time to reconnect?`
        : `${c.name} is fading — reach out to keep the relationship alive`
    items.push({
      type: "follow_up",
      priority,
      contactId: c.id,
      contactName: c.name,
      message: msg,
      actionUrl: `/contacts/${c.id}`,
    })
  }

  // Introductions: pairs sharing company, tag, or location
  for (const intro of computeIntroductions(contacts).slice(0, INTRO_CAP)) {
    items.push(intro)
  }

  // Enrichment: AI profile updated within last 7 days
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const enriched = contacts
    .filter((c) => c.profileUpdatedAt && new Date(c.profileUpdatedAt) >= cutoff)
    .sort(
      (a, b) =>
        new Date(b.profileUpdatedAt!).getTime() - new Date(a.profileUpdatedAt!).getTime()
    )
    .slice(0, ENRICHMENT_CAP)

  for (const c of enriched) {
    items.push({
      type: "enrichment",
      priority: 3,
      contactId: c.id,
      contactName: c.name,
      message: `${c.name}'s profile was recently updated — review new details`,
      actionUrl: `/contacts/${c.id}`,
    })
  }

  return items.sort((a, b) => a.priority - b.priority || a.type.localeCompare(b.type))
}

type Pair = { a: Contact; b: Contact; score: number; sharedAttribute: string }

function computeIntroductions(contacts: Contact[]): InsightItem[] {
  const pairs = new Map<string, Pair>()

  function addPair(a: Contact, b: Contact, attribute: string) {
    const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`
    const existing = pairs.get(key)
    if (existing) {
      existing.score++
    } else {
      pairs.set(key, { a, b, score: 1, sharedAttribute: attribute })
    }
  }

  function processPairs(group: Contact[], attribute: (c: Contact) => string) {
    const g = group.slice(0, MAX_GROUP_SIZE)
    for (let i = 0; i < g.length - 1; i++)
      for (let j = i + 1; j < g.length; j++)
        addPair(g[i], g[j], attribute(g[i]))
  }

  // By company
  const byCompany = new Map<string, Contact[]>()
  for (const c of contacts) {
    const co = c.company?.trim()
    if (!co) continue
    const g = byCompany.get(co.toLowerCase()) ?? []
    g.push(c)
    byCompany.set(co.toLowerCase(), g)
  }
  for (const group of byCompany.values())
    if (group.length >= 2) processPairs(group, (c) => `both at ${c.company}`)

  // By tag
  const byTag = new Map<string, { contacts: Contact[]; label: string }>()
  for (const c of contacts) {
    for (const t of (c.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean)) {
      const key = t.toLowerCase()
      const entry = byTag.get(key) ?? { contacts: [], label: t }
      entry.contacts.push(c)
      byTag.set(key, entry)
    }
  }
  for (const { contacts: group, label } of byTag.values())
    if (group.length >= 2) processPairs(group, () => `both tagged "${label}"`)

  // By location
  const byLocation = new Map<string, Contact[]>()
  for (const c of contacts) {
    const loc = c.location?.trim()
    if (!loc) continue
    const g = byLocation.get(loc.toLowerCase()) ?? []
    g.push(c)
    byLocation.set(loc.toLowerCase(), g)
  }
  for (const group of byLocation.values())
    if (group.length >= 2) processPairs(group, (c) => `both in ${c.location}`)

  return [...pairs.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ a, b, sharedAttribute }) => ({
      type: "introduction" as const,
      priority: 2 as const,
      contactId: a.id,
      contactName: a.name,
      secondaryContactId: b.id,
      secondaryContactName: b.name,
      message: `Introduce ${a.name} and ${b.name} — ${sharedAttribute}`,
      actionUrl: `/contacts/${a.id}`,
    }))
}
