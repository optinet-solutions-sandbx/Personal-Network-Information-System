// Shared demo dataset used by both seed.mjs and reset.mjs.
// `profileOnReset: false` marks the contact we leave blank to generate live in the demo.

export const contacts = [
  {
    name: "Sarah Chen",
    title: "Partner",
    company: "Lightfield Ventures",
    email: "sarah@lightfield.vc",
    phone: "+1 415 555 0192",
    location: "San Francisco, CA",
    tags: "investor, fintech, warm-lead",
    howWeMet: "SaaStr Annual 2026, introduced by Mark Rivera",
    profileOnReset: false, // ← left blank on purpose: generate live during the demo
    notes: [
      "Leads Series A fintech investments; writes $3-8M checks.",
      "Mentioned she's actively looking for B2B payments founders.",
      "Loves trail running — did the Marin Headlands 50k last month.",
      "Follow up after I connect her with the Plaid alum we discussed.",
    ],
  },
  {
    name: "Marcus Webb",
    title: "Head of Talent",
    company: "Northwind Recruiting",
    email: "marcus@northwind.io",
    phone: "+1 312 555 0143",
    location: "Chicago, IL",
    tags: "recruiter, hiring, partner",
    howWeMet: "Referral from a former colleague at the Chicago tech meetup",
    profileOnReset: true,
    notes: [
      "Places senior eng + design roles for Series B startups.",
      "Open to a referral-share arrangement for placements we send.",
      "Has two kids; daughter just started college at UIUC.",
    ],
  },
  {
    name: "Priya Nair",
    title: "Founder & CEO",
    company: "Cadence Health",
    email: "priya@cadencehealth.com",
    location: "Austin, TX",
    tags: "founder, healthtech, hot",
    howWeMet: "Cold intro via LinkedIn, then coffee in Austin",
    profileOnReset: true,
    notes: [
      "Building remote patient monitoring; raising a $5M seed.",
      "Needs intros to healthtech-focused angels and a fractional CFO.",
      "Birthday in March — send a note.",
    ],
  },
  {
    name: "David Okafor",
    title: "VP Business Development",
    company: "Atlas Logistics",
    email: "d.okafor@atlaslog.com",
    phone: "+1 646 555 0177",
    location: "New York, NY",
    tags: "bizdev, logistics, enterprise",
    howWeMet: "Met at the Supply Chain Innovation Summit panel",
    profileOnReset: true,
    notes: [
      "Owns partnerships for last-mile delivery in the Northeast.",
      "Exploring API integrations — could be a customer for a portfolio co.",
    ],
  },
];
