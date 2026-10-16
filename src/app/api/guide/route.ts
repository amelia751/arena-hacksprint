import { getAuthoringGuide } from "@/lib/env-service";
import { json } from "@/lib/http";

export async function GET() {
  return json(getAuthoringGuide());
}
