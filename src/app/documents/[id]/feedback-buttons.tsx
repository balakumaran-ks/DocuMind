"use client";

import { useState } from "react";
import { errorMessageFrom, GENERIC_ERROR } from "@/lib/api/client";
import type { Rating } from "@/lib/chat/message";

type Props = { messageId: string; initialRating: Rating | null };

/**
 * Thumbs up/down for one saved answer. A click shows the new rating at once;
 * the buttons wait until it's saved, and a failed save puts the old one back.
 */
export function FeedbackButtons({ messageId, initialRating }: Props) {
  const [rating, setRating] = useState(initialRating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rate(choice: Rating) {
    const previous = rating;
    const next = rating === choice ? null : choice;
    setRating(next);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: next }),
      });
      if (!response.ok) {
        setRating(previous);
        setError(await errorMessageFrom(response));
      }
    } catch {
      setRating(previous);
      setError(GENERIC_ERROR);
    }
    setSaving(false);
  }

  return (
    <div className="mt-2 flex items-center gap-1">
      {(["up", "down"] as const).map((choice) => {
        const label = choice === "up" ? "Good answer" : "Bad answer";
        return (
          <button
            key={choice}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={rating === choice}
            disabled={saving}
            onClick={() => void rate(choice)}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-wait aria-pressed:text-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 dark:aria-pressed:text-indigo-400"
          >
            <ThumbIcon down={choice === "down"} filled={rating === choice} />
          </button>
        );
      })}
      {error && (
        <p role="alert" className="ml-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function ThumbIcon({ down, filled }: { down: boolean; filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-4 w-4 ${down ? "rotate-180" : ""}`}
      fill={filled ? "currentColor" : "none"}
      fillOpacity={filled ? 0.15 : undefined}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}
