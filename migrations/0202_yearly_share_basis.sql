-- The yearly amount a bill's share was reserved for (orchestrator ruling, yearly-list check): the room check and the
-- one-cent rounding adjustment use it, never a later edited amount. Structure only (contracts section 5): a row saved
-- before it stays null, and the app reads the bill's yearly amount from its creation record in change_log.
ALTER TABLE yearly_bill_shares ADD COLUMN yearly_cents INTEGER;
