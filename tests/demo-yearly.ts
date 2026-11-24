// tests/demo-yearly.ts -- the sample household's yearly bills and raise as tests build them, from the same
// invented values the sample database is written with (demo/write-yearly.ts). Fresh copies on every call.
import { DEMO_RAISE, DEMO_YEARLY_BILLS, type DemoBillInput, type DemoRaiseInput } from "../demo/write-yearly.js";

export function demoYearlyBills(): DemoBillInput[] {
  return structuredClone(DEMO_YEARLY_BILLS);
}

export function demoRaiseInput(): DemoRaiseInput {
  return structuredClone(DEMO_RAISE);
}
