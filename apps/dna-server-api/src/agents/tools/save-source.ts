// save_source: collect a link for future sweeps. The agent saves a good information source it found, or resolves a
// lead a reader's upvote left. Discovery finds the site's feed, GitHub releases, or an article listing page.
import * as schema from "@earendil-works/pi-schema";
import { defineAppTool, toolError, toolText } from "@dna/durable-agent";
import type { Deps } from "../../deps.ts";
import { discoverSource, isAggregator, watching } from "../../news/sources/discover.ts";

export function saveSource(deps: Deps) {
  return defineAppTool({
    name: "save_source",
    returns:
      "Text: the saved source (id, name, kind, entries now, url), the source that already covers the site, or the skipped lead.",
    description:
      "Save a site as a source every future sweep fetches. Give lead_id for a lead from SOURCE_LEADS, or the url of a good information source you found (its blog, news page, feed or GitHub repo). It finds the feed itself. With skip true and a lead_id, close a lead that is not a news source.",
    parameters: schema.obj({
      url: schema.opt(schema.str()),
      lead_id: schema.opt(schema.int()),
      name: schema.opt(schema.str({ maxLength: 60 })),
      reason: schema.str({ minLength: 3, maxLength: 200 }),
      skip: schema.opt(schema.bool()),
    }),
    example: {
      lead_id: 3,
      reason: "The reader upvoted its post on durable agent runtimes.",
    },
    replay: "safe",
    execute: async (args) => {
      const { store, config, http, log } = deps;
      const lead = args.lead_id ? store.sources.lead(args.lead_id) : undefined;
      if (args.lead_id && !lead)
        return toolError(`save_source failed: no lead ${args.lead_id}.`, [
          "Use a lead id from SOURCE_LEADS in the sweep prompt.",
        ]);
      if (lead && lead.status !== "open")
        return toolText(
          `Lead ${lead.id} (${lead.site}) is already ${lead.status}${lead.sourceId ? ` as source #${lead.sourceId}` : ""}.`,
        );
      if (args.skip) {
        if (!lead) return toolError("save_source failed: skip needs a lead_id.");
        store.sources.resolveLead(lead.id, "skipped", args.reason);
        log.info("sources.lead_skipped", { leadId: lead.id, site: lead.site });
        return toolText(`Skipped lead ${lead.id} (${lead.site}): ${args.reason}`);
      }
      const url = args.url ?? lead?.url;
      if (!url || !/^https?:\/\//.test(url))
        return toolError("save_source failed: give lead_id or an http(s) url.");
      if (isAggregator(url))
        return toolError(
          `save_source failed: ${new URL(url).hostname} is searched every sweep already.`,
          ["Save the site the story links to instead."],
        );
      const existing = watching(store.sources.list(), url);
      if (existing) {
        if (lead) store.sources.resolveLead(lead.id, "saved", args.reason, existing.id);
        return toolText(`Already a source: #${existing.id} ${existing.name} (${existing.kind}).`);
      }
      if (store.sources.savedCount() >= config.maxSavedSources)
        return toolError(
          `save_source failed: ${config.maxSavedSources} saved sources is the cap (DNA_MAX_SAVED_SOURCES).`,
          lead ? ["Skip this lead with skip true, or ask the reader to remove a source."] : [],
        );
      let found;
      try {
        found = await discoverSource(http, url);
      } catch (error) {
        return toolError(`save_source failed: ${String((error as Error).message ?? error)}`, [
          lead
            ? "Pass a url for the site's blog or news page with this lead_id, or skip the lead with skip true."
            : "Pass the site's blog or news page, or move on.",
        ]);
      }
      const source =
        store.sources.byUrl(found.kind, found.url) ??
        store.sources.add({
          kind: found.kind,
          name: (args.name ?? found.name).slice(0, 60),
          url: found.url,
          weight: 1,
          intervalMin: 30,
          origin: lead ? "upvote" : "agent",
          reason: args.reason,
        });
      if (lead) store.sources.resolveLead(lead.id, "saved", args.reason, source.id);
      log.info("sources.saved", {
        sourceId: source.id,
        kind: source.kind,
        url: source.url,
        origin: source.origin,
        leadId: lead?.id,
      });
      return toolText(
        `Saved source #${source.id} ${source.name} (${source.kind}, ${found.entries} entries now): ${source.url}. Future sweeps fetch it every ${source.intervalMin} minutes.`,
      );
    },
  });
}
