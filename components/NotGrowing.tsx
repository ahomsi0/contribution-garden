import Link from "next/link";
import "@/components/leaderboard/leaderboard.css";

interface NotGrowingProps {
  message?: string;
}

export default function NotGrowing({
  message = "That country or gardener doesn't exist.",
}: NotGrowingProps) {
  return (
    <main className="board-page">
      <div className="board-page__inner">
        <h1>Nothing growing here</h1>
        <p>{message}</p>
        <Link className="board-page__back" href="/">
          Back to all countries
        </Link>
      </div>
    </main>
  );
}
