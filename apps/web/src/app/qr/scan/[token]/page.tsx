import { redirect } from "next/navigation";

export default async function QrScanTokenRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/scan-qr?token=${encodeURIComponent(token)}`);
}
