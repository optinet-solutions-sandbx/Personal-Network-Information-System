import { describe, it, expect } from "vitest";
import {
  contactsToCsv,
  parseCsv,
  csvRowsToContactInputs,
  contactsToVcf,
  parseVcf,
  detectFormat,
  parseContactsFile,
} from "@/lib/contact-io";
import type { Contact } from "@/lib/types";

function contact(p: Partial<Contact>): Contact {
  return {
    id: "x", name: "Test", email: null, phone: null, company: null, title: null,
    location: null, tags: null, birthday: null, howWeMet: null, customFields: null,
    profile: null, profileModel: null, profileUpdatedAt: null, healthScore: null,
    healthTier: null, healthInputs: null, followUpCadence: null, followUpCadenceDays: null,
    createdAt: "", updatedAt: "", ...p,
  };
}

describe("CSV export", () => {
  it("emits a header and quotes fields with commas/quotes/newlines", () => {
    const csv = contactsToCsv([
      contact({ name: "Ada, Lovelace", company: 'A "B" Co', howWeMet: "line1\nline2" }),
    ]);
    const [header, row] = csv.split("\r\n");
    expect(header.startsWith("name,email,phone,company,title,location,tags,birthday,howWeMet")).toBe(true);
    expect(row).toContain('"Ada, Lovelace"');
    expect(row).toContain('"A ""B"" Co"');
    expect(row).toContain('"line1\nline2"');
  });

  it("expands custom fields into their own columns (sorted)", () => {
    const csv = contactsToCsv([
      contact({ name: "A", customFields: { Interests: "chess", Age: "40" } }),
    ]);
    const header = csv.split("\r\n")[0];
    expect(header.endsWith("Age,Interests")).toBe(true);
  });
});

describe("CSV parse + mapping", () => {
  it("round-trips through export -> parse -> inputs", () => {
    const csv = contactsToCsv([
      contact({ name: "Ada, Lovelace", email: "ada@x.io", company: "A Co", customFields: { Interests: "chess" } }),
    ]);
    const inputs = csvRowsToContactInputs(parseCsv(csv));
    expect(inputs).toHaveLength(1);
    expect(inputs[0].name).toBe("Ada, Lovelace");
    expect(inputs[0].email).toBe("ada@x.io");
    expect(inputs[0].customFields).toEqual({ Interests: "chess" });
  });

  it("maps header aliases case-insensitively and unknown columns -> customFields", () => {
    const inputs = csvRowsToContactInputs(
      parseCsv("Full Name,E-Mail,Organization,Favorite Color\nGrace Hopper,grace@navy.mil,US Navy,teal")
    );
    expect(inputs[0]).toMatchObject({ name: "Grace Hopper", email: "grace@navy.mil", company: "US Navy" });
    expect(inputs[0].customFields).toEqual({ "Favorite Color": "teal" });
  });

  it("maps a LinkedIn connections export (Position -> title, URL -> custom)", () => {
    const inputs = csvRowsToContactInputs(
      parseCsv(
        "First Name,Last Name,URL,Email Address,Company,Position,Connected On\n" +
          "Ada,Lovelace,https://linkedin.com/in/ada,ada@x.io,Analytical Engines,Lead Engineer,01 Jan 2026"
      )
    );
    expect(inputs[0]).toMatchObject({
      name: "Ada Lovelace",
      email: "ada@x.io",
      company: "Analytical Engines",
      title: "Lead Engineer",
    });
    expect(inputs[0].customFields).toMatchObject({ URL: "https://linkedin.com/in/ada" });
  });

  it("combines First/Last name when no Name column", () => {
    const inputs = csvRowsToContactInputs(parseCsv("First Name,Last Name,Email\nAlan,Turing,alan@x.io"));
    expect(inputs[0].name).toBe("Alan Turing");
  });

  it("drops rows with no name", () => {
    const inputs = csvRowsToContactInputs(parseCsv("name,email\n,nobody@x.io\nReal,real@x.io"));
    expect(inputs.map((i) => i.name)).toEqual(["Real"]);
  });
});

describe("vCard", () => {
  it("exports and re-parses standard fields", () => {
    const vcf = contactsToVcf([
      contact({ name: "Ada Lovelace", email: "ada@x.io", phone: "+123", company: "A Co", title: "Engineer", location: "London", birthday: "1815-12-10" }),
    ]);
    expect(vcf).toContain("BEGIN:VCARD");
    expect(vcf).toContain("FN:Ada Lovelace");
    const inputs = parseVcf(vcf);
    expect(inputs[0]).toMatchObject({
      name: "Ada Lovelace", email: "ada@x.io", phone: "+123",
      company: "A Co", title: "Engineer", location: "London", birthday: "1815-12-10",
    });
  });

  it("parses N (Family;Given) when FN absent and handles line folding", () => {
    const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Hopper;Grace;;;\r\nNOTE:long\r\n folded note\r\nEND:VCARD";
    const inputs = parseVcf(vcf);
    expect(inputs[0].name).toBe("Grace Hopper");
    expect(inputs[0].howWeMet).toBe("longfolded note");
  });

  it("parses multiple cards", () => {
    const vcf = contactsToVcf([contact({ name: "A" }), contact({ name: "B" })]);
    expect(parseVcf(vcf).map((i) => i.name)).toEqual(["A", "B"]);
  });
});

describe("format detection", () => {
  it("detects vcf by extension or content, else csv", () => {
    expect(detectFormat("x.vcf", "")).toBe("vcf");
    expect(detectFormat("x.txt", "BEGIN:VCARD")).toBe("vcf");
    expect(detectFormat("x.csv", "name,email")).toBe("csv");
  });

  it("parseContactsFile routes by format", () => {
    expect(parseContactsFile("a.csv", "name\nFoo")[0].name).toBe("Foo");
    expect(parseContactsFile("a.vcf", "BEGIN:VCARD\nFN:Bar\nEND:VCARD")[0].name).toBe("Bar");
  });
});
