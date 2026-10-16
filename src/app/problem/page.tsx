import type { Metadata } from "next";
import { ProblemFigure } from "@/components/ProblemFigure";

export const metadata: Metadata = {
  title: "Arena — the problem",
  description: "Human-versus-agent games have no training data, because the seats share no interface.",
};

export default function ProblemPage() {
  return (
    <main className="diagram-page">
      <p className="kicker">Appendix</p>
      <h1>Two seats, no shared interface</h1>
      <p className="diagram-lead">
        Why the most useful game trajectories — a person thinking across the table from a model
        — are the ones nobody collects.
      </p>
      <ProblemFigure />
    </main>
  );
}
