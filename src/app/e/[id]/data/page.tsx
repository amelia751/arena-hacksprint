import { EnvData } from "@/components/EnvLoader";

export const dynamic = "force-dynamic";

export default async function DataPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EnvData id={id} />;
}
