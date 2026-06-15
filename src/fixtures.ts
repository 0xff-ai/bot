import { Areas } from "./areas";

/** A small areas fixture mirroring a realistic bot.yml. */
export const testAreas = new Areas([
  { id: "providers", heading: "Providers & projected paths", aliases: ["provider", "paths"] },
  { id: "runtime", heading: "Runtime & mounts", aliases: ["runtime", "daemon", "mount"] },
  { id: "cli", heading: "CLI & workflow", aliases: ["cli", "command"] },
  { id: "packaging", heading: "Packaging & release", aliases: ["packaging", "npm", "release"] },
]);
