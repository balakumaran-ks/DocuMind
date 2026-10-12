import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Privacy policy · DocuMind" };

const ISSUES = "https://github.com/balakumaran-ks/DocuMind/issues";
const USER_DATA_POLICY = "https://developers.google.com/terms/api-services-user-data-policy";
const GEMINI_TERMS = "https://ai.google.dev/gemini-api/terms";

const link = "text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400";

/** What DocuMind collects, why, who processes it, and how to delete it. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12 leading-7 text-zinc-700 dark:text-zinc-300">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Privacy policy</h1>
        <p className="mt-1 text-sm text-zinc-500">Last updated 12 October 2026</p>
      </div>

      <p>
        DocuMind is an open-source demonstration app: you upload PDFs, ask questions about them, and get answers that cite
        their pages. This page explains what it stores, why, who processes it, and how to delete it.
      </p>

      <Section title="Your Google account">
        <p>
          You sign in with Google. DocuMind receives your Google account id, name, email address and profile picture, and
          uses them only to identify you: to keep your documents and chats separate from everyone else&rsquo;s and to show
          who is signed in. It asks for nothing else from your Google account. This information is not sold, not shared
          for advertising, and not used for anything else.
        </p>
      </Section>

      <Section title="What you add">
        <p>
          When you upload a PDF, DocuMind keeps its file name, size and a fingerprint (a SHA-256 hash), and the text of
          each page. The PDF file itself is not stored. The text is split into passages, each with a numeric vector used
          for search. DocuMind also keeps your questions and its answers, which passages each answer used, how long it
          took, how many tokens it used, any rating you give it, and a count of your uploads per day (kept for two days).
        </p>
      </Section>

      <Section title="Google's Gemini API">
        <p>
          To search and answer, the text of your documents and your questions are sent to Google&rsquo;s Gemini API. DocuMind
          uses its free tier, under which Google may use what is sent to improve its products, and human reviewers may read
          it (
          <a href={GEMINI_TERMS} className={link}>
            Gemini API terms
          </a>
          ). <strong>Don&rsquo;t upload anything confidential or personal.</strong>
        </p>
      </Section>

      <Section title="Who processes your data">
        <ul className="list-disc pl-6">
          <li>Vercel hosts the app and keeps request logs.</li>
          <li>MongoDB Atlas stores the data above, encrypted at rest.</li>
          <li>Google handles sign-in and, through the Gemini API, search and answers.</li>
        </ul>
        <p>All traffic is encrypted (HTTPS), and each request can only reach the signed-in user&rsquo;s own data.</p>
      </Section>

      <Section title="Cookies">
        <p>
          DocuMind sets only the cookies sign-in needs, including an encrypted session cookie. There are no analytics,
          advertising or tracking cookies.
        </p>
      </Section>

      <Section title="Keeping and deleting your data">
        <p>
          Your data is kept until you delete it. Deleting a document removes its text, passages and chats. &ldquo;Delete my
          account&rdquo;, at the bottom of your document list, removes everything above, including your profile, and signs
          you out. Copies already sent to Google under the Gemini API terms are governed by those terms.
        </p>
      </Section>

      <Section title="Google API data">
        <p>
          DocuMind&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href={USER_DATA_POLICY} className={link}>
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </Section>

      <Section title="Children">
        <p>DocuMind is not intended for children under 13.</p>
      </Section>

      <Section title="Questions and changes">
        <p>
          For questions about this policy,{" "}
          <a href={ISSUES} className={link}>
            open an issue
          </a>{" "}
          on the project&rsquo;s GitHub page; please don&rsquo;t include personal details there. If this policy changes, the
          date at the top changes with it. See also the{" "}
          <Link href="/terms" className={link}>
            terms of use
          </Link>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}
