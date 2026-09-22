import { notFound } from "next/navigation";
import { Stack4That } from "@/components/Stack4That";
import { getArchitecture } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export default async function SharedStack({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const arch = await getArchitecture(id);
  if (!arch) notFound();
  return <Stack4That initialArchitecture={arch} />;
}
