import { EnvPlay } from "@/components/EnvLoader";

export const dynamic = "force-dynamic";

export default async function EnvironmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EnvPlay id={id} />;
}
