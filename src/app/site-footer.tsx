import Link from "next/link";

const REPOSITORY = "https://github.com/balakumaran-ks/DocuMind";

/** Links every page needs: the privacy policy, the terms and the source code. */
export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-6 gap-y-2 px-6 py-6 text-sm text-zinc-500">
        <span>DocuMind</span>
        <Link href="/privacy" className="hover:text-indigo-600 dark:hover:text-indigo-400">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-indigo-600 dark:hover:text-indigo-400">
          Terms
        </Link>
        <a href={REPOSITORY} className="hover:text-indigo-600 dark:hover:text-indigo-400">
          Source code
        </a>
      </nav>
    </footer>
  );
}
