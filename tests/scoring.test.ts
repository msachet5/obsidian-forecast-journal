import { test } from "node:test";
import * as assert from "node:assert/strict";
import { Forecast, brier, calibrationBins, due, parseProbability, reliabilitySvg, score, slug } from "../src/scoring";

const f = (p: number, o: "yes" | "no" | null, extra: Partial<Forecast> = {}): Forecast => ({
	id: String(Math.random()), question: "q", probability: p, created: "2026-01-01", outcome: o, tags: [], ...extra,
});

test("brier basics", () => {
	assert.equal(brier(1, "yes"), 0);
	assert.equal(brier(0.5, "no"), 0.25);
	assert.ok(Math.abs(brier(0.7, "no") - 0.49) < 1e-12);
});

test("score: coin flip has zero skill", () => {
	const s = score([f(0.5, "yes"), f(0.5, "no")]);
	assert.equal(s.brier, 0.25);
	assert.equal(s.skillVsCoinFlip, 0);
});

test("score ignores unresolved and void", () => {
	const s = score([f(0.9, "yes"), f(0.9, null), f(0.9, "void" as never)]);
	assert.equal(s.resolved, 1);
});

test("value added versus baseline", () => {
	const fs = [f(0.8, "yes", { baseline: 0.5 }), f(0.2, "no", { baseline: 0.5 }), f(0.9, "yes")];
	const s = score(fs);
	assert.equal(s.baselineBrier, 0.25);
	assert.ok(Math.abs((s.yourBrierOnBaselined as number) - 0.04) < 1e-12);
	assert.ok((s.valueAdded as number) > 0);
});

test("calibration bins and overconfidence", () => {
	// says 90% but only half come true: overconfident
	const fs = [f(0.9, "yes"), f(0.9, "no"), f(0.9, "yes"), f(0.9, "no")];
	const bins = calibrationBins(fs);
	assert.equal(bins.length, 1);
	assert.equal(bins[0].observedRate, 0.5);
	assert.ok((score(fs).overconfidence as number) > 0.3);
	assert.ok(calibrationBins([f(1, "yes")]).length === 1, "p = 1 lands in the top bin");
});

test("due list", () => {
	const fs = [f(0.5, null, { resolveBy: "2026-01-10" }), f(0.5, null, { resolveBy: "2026-03-01" }), f(0.5, "yes", { resolveBy: "2026-01-01" })];
	assert.equal(due(fs, "2026-02-01").length, 1);
});

test("parse probability", () => {
	assert.equal(parseProbability("70%"), 0.7);
	assert.equal(parseProbability("0.7"), 0.7);
	assert.equal(parseProbability("70"), 0.7);
	assert.equal(parseProbability("0,25"), 0.25);
	assert.equal(parseProbability("150%"), null);
	assert.equal(parseProbability("abc"), null);
});

test("slug and svg", () => {
	assert.equal(slug("Will CPI be > 3% in Q4?"), "will-cpi-be-3-in-q4");
	assert.ok(reliabilitySvg(calibrationBins([f(0.7, "yes"), f(0.7, "no")])).includes("<circle"));
});
