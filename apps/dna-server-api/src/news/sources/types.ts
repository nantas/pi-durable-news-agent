import type { Store } from "../../db/store.ts";
import type { RunCommand } from "../commands.ts";
import type { Source } from "@dna/sdk";
import type { Logger } from "@dna/sdk/node";
import type { Http } from "../http.ts";

export interface FeedEntry {
  url: string;
  title: string;
  excerpt?: string;
  contentMd?: string;
  publishedAt?: string;
  author?: string;
  imageUrl?: string;
  discussionUrl?: string;
  points?: number;
  comments?: number;
  metadata?: Record<string, unknown>;
}

export interface FetchResult {
  ok: boolean;
  status: string;
  entries: FeedEntry[];
  notModified?: boolean;
  etag?: string;
  lastModified?: string;
  error?: string;
}

export interface FetchContext {
  store?: Store;
  run?: RunCommand;
  http: Http;
  log?: Logger;
  validators?: { etag?: string; lastModified?: string };
  /** Topic queries for search kinds (hn_search). */
  queries?: string[];
  since: Date;
}

export type Fetcher = (source: Source, ctx: FetchContext) => Promise<FetchResult>;
