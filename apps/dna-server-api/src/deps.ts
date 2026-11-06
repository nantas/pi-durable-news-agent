// What tools, tasks and routes share. Built once in runtime.ts.
import type { ModelCatalog } from "@dna/durable-agent";
import type { Logger } from "@dna/sdk/node";
import type { RunCommand } from "./news/commands.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db/store.ts";
import type { Bus } from "./events.ts";
import type { Dates } from "./news/dates.ts";
import type { Judge } from "./news/hfs.ts";
import type { Http } from "./news/http.ts";
import type { Images } from "./news/images.ts";
import type { Quick } from "./news/quick.ts";
import type { Schedule } from "./news/schedule.ts";
import type { SearchService } from "./news/search/index.ts";

export interface Deps {
  run: RunCommand;
  config: Config;
  log: Logger;
  store: Store;
  bus: Bus;
  judge: Judge;
  search: SearchService;
  images: Images;
  http: Http;
  catalog: ModelCatalog;
  /** The quick model for one-shot jobs. */
  quick: Quick;
  coverage: Quick;
  summary: Quick;
  /** Publish dates from pages, with the quick model as the fallback. */
  dates: Dates;
  /** How often scheduled sweeps run. */
  schedule: Schedule;
}
