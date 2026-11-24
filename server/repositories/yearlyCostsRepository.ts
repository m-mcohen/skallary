import { yearlyCostsStore, type YearlyCostsStore } from "../../src/data/yearly-costs.store.js";
import { openRepo } from "../db/openDb.js";

export type YearlyCostsRepository = YearlyCostsStore;

export function yearlyCostsRepository(): YearlyCostsRepository {
  return yearlyCostsStore(openRepo().connection());
}