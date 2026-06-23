import ContactSubsetView from "@/components/ContactSubsetView";

export default function BirthdaysPage() {
  return (
    <ContactSubsetView
      variant="birthday"
      title="Contacts with birthdays"
      subtitle="People with a birthday on file."
      emptyText="No contacts have a birthday on file yet."
    />
  );
}
