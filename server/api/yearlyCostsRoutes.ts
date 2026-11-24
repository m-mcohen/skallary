import express, { Router, type ErrorRequestHandler } from "express";
import { holidayService } from "../services/holidayService.js";
import { yearlyCostsService } from "../services/yearlyCostsService.js";
import type { BillEventKind } from "../../src/data/yearly-costs.store.js";

function month(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("Choose a valid month.");
  }
  return value;
}

function billId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) throw new Error("Choose a yearly bill.");
  return id;
}

function raiseId(value: string): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) throw new Error("Choose a raise.");
  return id;
}

function billEvent(body: unknown) {
  if (!body || typeof body !== "object") throw new Error("Choose how to update this bill.");
  const { kind, obligationYear, dueMonth, sourceTransactionId } = body as Record<string, unknown>;
  if (kind !== "picked" && kind !== "ticked" && kind !== "still-exists" && kind !== "gone" && kind !== "told-new-amount") {
    throw new Error("Choose how to update this bill.");
  }
  const due = month(dueMonth);
  if (obligationYear !== Number(due.slice(0, 4))) throw new Error("Choose the year and month the bill was due.");
  if (kind === "picked" && (typeof sourceTransactionId !== "string" || !sourceTransactionId.trim())) {
    throw new Error("Choose a payment for this bill.");
  }
  return { kind: kind as BillEventKind, obligationYear, dueMonth: due,
    ...(typeof sourceTransactionId === "string" ? { sourceTransactionId } : {}) };
}

export function yearlyCostsRoutes(): Router {
  const r = Router();
  r.get("/holiday-calendars", (_req, res) => res.json(holidayService().calendars()));
  r.post("/holiday-calendars/import", express.text({ type: "text/calendar", limit: "5mb" }), (req, res) => {
    if (typeof req.body !== "string") throw new Error("Choose a calendar file to import.");
    const { name, calendarId } = req.query;
    if (typeof name !== "string") throw new Error("Enter a name for the calendar.");
    if (calendarId !== undefined && typeof calendarId !== "string") throw new Error("Choose one calendar to update.");
    res.json(holidayService().importFile(name, req.body, calendarId));
  });
  r.put("/holiday-calendars/:id", (req, res) => {
    if (typeof req.body?.on !== "boolean") throw new Error("Choose whether to show this calendar.");
    holidayService().setOn(req.params.id, req.body.on);
    res.status(204).end();
  });
  r.delete("/holiday-calendars/:id", (req, res) => {
    holidayService().remove(req.params.id);
    res.status(204).end();
  });
  r.get("/holidays", (req, res) => {
    const from = month(req.query.from);
    const to = month(req.query.to);
    if (from > to) throw new Error("The last month must be on or after the first month.");
    res.json(holidayService().holidaysBetween(from, to));
  });

  r.get("/yearly/bills", (_req, res) => res.json(yearlyCostsService().listBills()));
  r.post("/yearly/bills", (req, res) => res.json(yearlyCostsService().addBill(req.body)));
  r.put("/yearly/bills/:id", (req, res) => {
    yearlyCostsService().updateBill(billId(req.params.id), req.body);
    res.status(204).end();
  });
  r.delete("/yearly/bills/:id", (req, res) => {
    yearlyCostsService().removeBill(billId(req.params.id));
    res.status(204).end();
  });
  r.post("/yearly/bills/:id/events", (req, res) => {
    yearlyCostsService().recordEvent(billId(req.params.id), billEvent(req.body));
    res.status(204).end();
  });
  r.get("/yearly/bills/:id/charges", (req, res) => res.json(yearlyCostsService().chargesFor(billId(req.params.id))));
  r.get("/yearly/occurrences", (req, res) => {
    const from = month(req.query.from);
    const to = month(req.query.to);
    if (from > to) throw new Error("The last month must be on or after the first month.");
    res.json(yearlyCostsService().occurrences(from, to));
  });

  r.get("/yearly/raises", (_req, res) => res.json(yearlyCostsService().listRaises()));
  r.post("/yearly/raises", (req, res) => res.json(yearlyCostsService().addRaise(req.body)));
  r.put("/yearly/raises/:id", (req, res) => res.json(yearlyCostsService().updateRaise(raiseId(req.params.id), req.body)));
  r.delete("/yearly/raises/:id", (req, res) => {
    yearlyCostsService().removeRaise(raiseId(req.params.id));
    res.status(204).end();
  });
  r.get("/yearly/heads-up", (_req, res) => res.json(yearlyCostsService().headsUp()));
  r.get("/yearly/proposals", (_req, res) => res.json(yearlyCostsService().proposals()));

  const fail: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error.status === 413) {
      res.status(413).json({ ok: false, error: "Choose a calendar file of 5 MB or less." });
      return;
    }
    res.status(400).json({ ok: false, error: error instanceof Error && error.name === "Error" && !("code" in error) ? error.message : "The request could not be completed. Nothing was changed." });
  };
  r.use(fail);
  return r;
}
