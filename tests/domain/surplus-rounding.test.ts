// tests/domain/surplus-rounding.test.ts
//
// One rounding path for the monthly surplus. Runway and Check a salary once differed by a
// cent for the same what-if: Runway pays the monthly paycheck and the monthly maaser, each
// rounded on its own (takeHomeMonthlyCents), while Check a salary rounded the yearly
// take-home once and divided by 12. Both now take the month from the same two rounded figures.
import { expect, test } from "vitest";
import { spendableAtSalary, DEFAULT_SALARY_ASSUMPTIONS } from "../../src/domain/salary";
import { takeHomeMonthlyCents } from "../../src/domain/what-if";

const a = DEFAULT_SALARY_ASSUMPTIONS;

test("Check a salary's month equals Runway's paycheck less the larger of maaser and the Charity line", () => {
  for (let gross = 9_000_000; gross <= 25_000_000; gross += 123_457) {
    for (const charityLineMonthly of [0, 60_000]) {
      const { paycheckCents, maaserCents } = takeHomeMonthlyCents(gross, a);
      const runwayMonth = paycheckCents - Math.max(charityLineMonthly, maaserCents);
      expect(spendableAtSalary(gross, charityLineMonthly * 12, a).spendableMonthlyCents).toBe(runwayMonth);
    }
  }
});
