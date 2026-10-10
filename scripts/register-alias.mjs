// Lets Node run the app's TypeScript directly (node --import ./scripts/register-alias.mjs script.ts):
// maps "@/..." to src/ and resolves extensionless imports to .ts files, as the bundler does.
import { registerHooks } from "node:module";

const SRC = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
    try {
      return nextResolve(target, context);
    } catch (error) {
      const local = target.startsWith(".") || target.startsWith("file:");
      if (!local || error?.code !== "ERR_MODULE_NOT_FOUND" || /\.[cm]?[jt]s$/.test(target)) throw error;
      for (const suffix of [".ts", "/index.ts"]) {
        try {
          return nextResolve(target + suffix, context);
        } catch {
          // try the next form
        }
      }
      throw error;
    }
  },
});
