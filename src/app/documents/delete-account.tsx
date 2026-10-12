"use client";

import { useState } from "react";

type Props = { action: () => Promise<void> };

/** "Delete my account", with a confirmation that says what will be deleted. */
export function DeleteAccount({ action }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="self-start text-sm text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
      >
        Delete my account
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950">
      <p className="text-red-800 dark:text-red-200">
        This deletes all your documents, chats and your profile from DocuMind, and signs you out. It can&rsquo;t be undone.
      </p>
      <span className="flex gap-2">
        <button type="submit" className="rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-500">
          Delete everything
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
        >
          Cancel
        </button>
      </span>
    </form>
  );
}
