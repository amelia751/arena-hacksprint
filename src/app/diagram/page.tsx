import type { Metadata } from "next";
import { DiagramFigure } from "@/components/DiagramFigure";

export const metadata: Metadata = {
  title: "Arena — how it is put together",
  description: "The person, the agent, the page, and the tape.",
};

export default function DiagramPage() {
  return (
    <main className="diagram-page">
      <p className="kicker">Appendix</p>
      <h1>How it is put together</h1>
      <p className="diagram-lead">
        One live page. The person clicks the board. The agent calls tools. Both
        write the same match.
      </p>
      <DiagramFigure />
    </main>
  );
}
