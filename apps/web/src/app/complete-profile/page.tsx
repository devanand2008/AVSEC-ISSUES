import { redirect } from "next/navigation";

export default function CompleteProfileRoute() {
  redirect("/profile/setup");
}
