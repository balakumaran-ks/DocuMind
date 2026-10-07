import { MongoBinary } from "mongodb-memory-server";

/**
 * Runs once before any test file. Makes sure the MongoDB binary used by the
 * integration tests is downloaded (into .cache/mongodb-binaries, configured in
 * package.json), so a first-time download of a few hundred MB is never cut
 * short by a per-test hook timeout.
 */
export default async function setup() {
  await MongoBinary.getPath();
}
