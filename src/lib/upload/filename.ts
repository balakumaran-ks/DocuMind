import { LIMITS } from "@/lib/limits";

/** C0 and C1 control characters (tabs and newlines become spaces first). */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
/** Marks and overrides that change text direction, which can disguise a name (e.g. U+202E). */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * The browser-supplied file name, made safe to store and show: control and
 * direction characters removed, whitespace collapsed, and anything longer than
 * `LIMITS.maxFilenameChars` shortened with "…", keeping the extension.
 */
export function cleanFilename(name: string): string {
  const cleaned = name.replace(/[\t\n\r]/g, " ").replace(CONTROL, "").replace(BIDI, "").replace(/\s+/g, " ").trim();
  if (cleaned === "") return "document.pdf";
  if (cleaned.length <= LIMITS.maxFilenameChars) return cleaned;
  const extension = /\.[A-Za-z0-9]{1,5}$/.exec(cleaned)?.[0] ?? "";
  return `${cleaned.slice(0, LIMITS.maxFilenameChars - extension.length - 1)}…${extension}`;
}
