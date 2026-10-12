/**
 * Usage report for the app's database: questions per UTC day and, over the
 * period, answers, refusals, answer time, answers per model (so use of the
 * backup model shows up), ratings and tokens.
 *
 *   npm run stats              # the last 14 days
 *   npm run stats -- --days 30
 *
 * This is the one query that spans users, so it prints aggregates only: no
 * question or answer text leaves the database (refusals are detected inside
 * the query) and no user is named. It runs from a developer machine with the
 * database credentials in .env.local, never from the app.
 */
import { MongoClient } from "mongodb";
import { startOfUtcDay } from "@/lib/db/chats";
import { readServerEnv } from "@/lib/env";
import { REFUSAL, REFUSAL_ACROSS } from "@/lib/rag/prompt";
import { summarizeUsage, type UsageRow } from "@/lib/stats/usage";

const DAY_MS = 24 * 60 * 60 * 1000;
const flag = process.argv.indexOf("--days");
const days = flag === -1 ? 14 : Number(process.argv[flag + 1]);
if (!Number.isInteger(days) || days < 1) throw new Error("--days takes a whole number of days, e.g. --days 30");

const env = readServerEnv();
const now = new Date();
const since = startOfUtcDay(new Date(now.getTime() - (days - 1) * DAY_MS));
const client = await MongoClient.connect(env.mongodbUri, { appName: "documind-scripts" });

try {
  const rows = await client
    .db(env.mongodbDb)
    .collection("messages")
    .aggregate<UsageRow>([
      { $match: { createdAt: { $gte: since } } },
      {
        $project: {
          _id: 0,
          role: 1,
          createdAt: 1,
          latencyMs: 1,
          model: 1,
          usage: 1,
          rating: "$feedback.rating",
          refused: { $in: [{ $trim: { input: "$content" } }, [REFUSAL, REFUSAL_ACROSS]] },
        },
      },
    ])
    .toArray();
  const summary = summarizeUsage(rows, { since, now });

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const count = (n: number) => n.toLocaleString("en-US");
  console.log(`Usage, ${summary.days[0]?.date} to ${summary.days.at(-1)?.date} (${days} days)\n`);
  console.log("Questions per day");
  for (const day of summary.days) console.log(`  ${day.date}  ${day.questions}`);
  console.log("");
  console.log(`Questions      ${count(summary.questions)}`);
  console.log(`Answers        ${count(summary.answers)} (${count(summary.refusals)} refusals)`);
  console.log(
    `Answer time    ${summary.answerTime ? `median ${seconds(summary.answerTime.medianMs)}, p90 ${seconds(summary.answerTime.p90Ms)}` : "n/a"}`,
  );
  const models = Object.entries(summary.models).sort((a, b) => b[1] - a[1]);
  console.log(`Answer models  ${models.length > 0 ? models.map(([model, n]) => `${model} ${n}`).join(", ") : "n/a"}`);
  console.log(`Ratings        up ${summary.ratings.up}, down ${summary.ratings.down}`);
  console.log(`Tokens         in ${count(summary.tokens.input)}, out ${count(summary.tokens.output)}`);
} finally {
  await client.close();
}
