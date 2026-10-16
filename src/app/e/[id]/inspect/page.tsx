import { EnvInspect } from "@/components/EnvLoader";

export const dynamic = "force-dynamic";

export default async function InspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EnvInspect id={id} />;
}
