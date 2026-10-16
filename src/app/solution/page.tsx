import type { Metadata } from "next";
import { SolutionFigure } from "@/components/SolutionFigure";

export const metadata: Metadata = {
  title: "Arena — the solution",
  description: "One live page, two interfaces, one step(), one trajectory dataset.",
};

export default function SolutionPage() {
  return (
    <main className="diagram-page">
      <p className="kicker">Appendix</p>
      <h1>One page, two interfaces</h1>
      <p className="diagram-lead">
        The person clicks the board. The agent calls tools on the same document. Both moves go
        through one <code>step()</code> and land in one dataset.
      </p>
      <SolutionFigure />
    </main>
  );
}
