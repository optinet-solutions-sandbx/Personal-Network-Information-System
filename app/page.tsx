import { redirect } from "next/navigation";

// The dashboard is the app's landing page. The contacts list lives at
// /contacts; this root route just forwards there.
export default function RootPage() {
  redirect("/dashboard");
}
