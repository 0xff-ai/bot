// Changelog areas are the consuming repo's product vocabulary, not the bot's, so
// they come from `.github/bot.yml` (see config.ts) rather than being hardcoded.
// This is the runtime view over that list: it both drives the LLM's area enum and
// orders the `### <heading>` subsections in CHANGELOG.md. The last area in the
// list is the catch-all for anything unclassifiable.

export type Area = {
  id: string;
  /** The `### ` subsection heading written into CHANGELOG.md and the proposal. */
  heading: string;
  /** Lowercase labels (ids, headings, synonyms) that resolve onto this area. */
  aliases: string[];
};

export class Areas {
  private readonly byIdMap: Map<string, Area>;

  // A non-empty tuple makes "areas must not be empty" a compile-time guarantee for
  // direct callers; the YAML boundary proves it at runtime with zod's .min(1)
  // (config.ts) and asserts into this type. Uniqueness can't be a simple type, so
  // it stays a runtime check.
  constructor(readonly list: readonly [Area, ...Area[]]) {
    this.byIdMap = new Map(list.map((a) => [a.id, a]));
    if (this.byIdMap.size !== list.length) {
      throw new Error("bot.yml: area ids must be unique");
    }
  }

  /** Area ids in canonical order, as a non-empty tuple for `z.enum`. */
  get ids(): [string, ...string[]] {
    return this.list.map((a) => a.id) as [string, ...string[]];
  }

  /** The trailing catch-all area (last in canonical order). */
  get fallback(): Area {
    return this.list[this.list.length - 1]!;
  }

  byId(id: string): Area {
    const area = this.byIdMap.get(id);
    if (!area) throw new Error(`unknown area id: ${id}`);
    return area;
  }

  /** Index in canonical order; used to sort subsections deterministically. */
  index(id: string): number {
    return this.list.findIndex((a) => a.id === id);
  }

  /**
   * Resolve a free-text label (an id, a heading, or an alias; any case) to a
   * canonical area, or undefined when nothing matches. Used when parsing the LLM
   * draft and the `/changelog <area>: ...` command, where humans type a heading or
   * a loose synonym.
   */
  resolve(label: string): Area | undefined {
    const needle = label.trim().toLowerCase();
    if (needle.length === 0) return undefined;
    for (const area of this.list) {
      if (area.id.toLowerCase() === needle) return area;
      if (area.heading.toLowerCase() === needle) return area;
      if (area.aliases.some((alias) => alias.toLowerCase() === needle)) return area;
    }
    return undefined;
  }
}
