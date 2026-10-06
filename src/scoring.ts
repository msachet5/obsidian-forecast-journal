// Pure scoring functions: no Obsidian imports, unit-tested in node.

export type Outcome = "yes" | "no" | "void" | null;

export interface Forecast {
	id: string;
	question: string;
	probability: number; // your probability that the answer is "yes", 0..1
	baseline?: number | null; // what a base rate, model or market said, 0..1
	created: string; // ISO date
	resolveBy?: string | null;
	outcome: Outcome;
	resolvedOn?: string | null;
	tags: string[];
	path?: string;
}

export interface Bin {
	lower: number;
	upper: number;
	count: number;
	meanForecast: number;
	observedRate: number;
}

export interface Score {
	resolved: number;
	brier: number | null;
	baselineBrier: number | null; // Brier of the baseline on forecasts that have one
	yourBrierOnBaselined: number | null; // your Brier on the same subset
	valueAdded: number | null; // baselineBrier - yourBrierOnBaselined; positive = your judgment helped
	skillVsCoinFlip: number | null; // 1 - brier / 0.25
	logLoss: number | null;
	bins: Bin[];
	overconfidence: number | null; // mean |p - 0.5| minus mean |hit rate gap|: see docs
}

const clamp = (p: number) => Math.min(Math.max(p, 1e-6), 1 - 1e-6);

export function brier(p: number, outcome: "yes" | "no"): number {
	const o = outcome === "yes" ? 1 : 0;
	return (p - o) ** 2;
}

export function isScorable(f: Forecast): f is Forecast & { outcome: "yes" | "no" } {
	return (f.outcome === "yes" || f.outcome === "no") && Number.isFinite(f.probability);
}

export function calibrationBins(fs: Forecast[], nBins = 10): Bin[] {
	const bins: Bin[] = [];
	for (let i = 0; i < nBins; i++) {
		const lower = i / nBins;
		const upper = (i + 1) / nBins;
		const inBin = fs.filter(
			(f) => isScorable(f) && f.probability >= lower && (i === nBins - 1 ? f.probability <= upper : f.probability < upper),
		);
		if (!inBin.length) continue;
		bins.push({
			lower,
			upper,
			count: inBin.length,
			meanForecast: inBin.reduce((s, f) => s + f.probability, 0) / inBin.length,
			observedRate: inBin.filter((f) => f.outcome === "yes").length / inBin.length,
		});
	}
	return bins;
}

export function score(all: Forecast[], nBins = 10): Score {
	const fs = all.filter(isScorable);
	const n = fs.length;
	if (!n) {
		return { resolved: 0, brier: null, baselineBrier: null, yourBrierOnBaselined: null, valueAdded: null, skillVsCoinFlip: null, logLoss: null, bins: [], overconfidence: null };
	}
	const b = fs.reduce((s, f) => s + brier(f.probability, f.outcome), 0) / n;
	const ll = fs.reduce((s, f) => s - Math.log(f.outcome === "yes" ? clamp(f.probability) : 1 - clamp(f.probability)), 0) / n;
	const based = fs.filter((f) => typeof f.baseline === "number" && Number.isFinite(f.baseline));
	let baselineBrier: number | null = null;
	let yours: number | null = null;
	if (based.length) {
		baselineBrier = based.reduce((s, f) => s + brier(f.baseline as number, f.outcome), 0) / based.length;
		yours = based.reduce((s, f) => s + brier(f.probability, f.outcome), 0) / based.length;
	}
	const bins = calibrationBins(fs, nBins);
	// Overconfidence: weighted mean of (distance of forecasts from 0.5) - (distance of outcomes from 0.5) per bin.
	// Positive means forecasts are more extreme than outcomes justify.
	const oc = bins.length
		? bins.reduce((s, bin) => s + bin.count * (Math.abs(bin.meanForecast - 0.5) - Math.abs(bin.observedRate - 0.5)), 0) / n
		: null;
	return {
		resolved: n,
		brier: b,
		baselineBrier,
		yourBrierOnBaselined: yours,
		valueAdded: baselineBrier !== null && yours !== null ? baselineBrier - yours : null,
		skillVsCoinFlip: 1 - b / 0.25,
		logLoss: ll,
		bins,
		overconfidence: oc,
	};
}

export function due(fs: Forecast[], today: string): Forecast[] {
	return fs
		.filter((f) => f.outcome === null && f.resolveBy && f.resolveBy <= today)
		.sort((a, b) => (a.resolveBy ?? "").localeCompare(b.resolveBy ?? ""));
}

export function parseProbability(input: string): number | null {
	const t = input.trim().replace(",", ".");
	const m = t.match(/^(\d+(?:\.\d+)?)\s*(%?)$/);
	if (!m) return null;
	let v = parseFloat(m[1]);
	if (m[2] === "%" || v > 1) v = v / 100;
	return v >= 0 && v <= 1 ? v : null;
}

export function slug(text: string, max = 60): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, max) || "forecast";
}

export function reliabilitySvg(bins: Bin[], size = 260): string {
	const pad = 28;
	const s = size - pad * 2;
	const x = (v: number) => pad + v * s;
	const y = (v: number) => size - pad - v * s;
	const dots = bins
		.map((b) => {
			const r = 3 + Math.min(9, Math.sqrt(b.count) * 1.5);
			return `<circle cx="${x(b.meanForecast).toFixed(1)}" cy="${y(b.observedRate).toFixed(1)}" r="${r.toFixed(1)}" class="fj-dot"><title>${Math.round(b.lower * 100)}-${Math.round(b.upper * 100)}%: ${b.count} forecasts, ${Math.round(b.observedRate * 100)}% came true</title></circle>`;
		})
		.join("");
	return `<svg viewBox="0 0 ${size} ${size}" class="fj-reliability" role="img" aria-label="Calibration chart">
<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="fj-diagonal"/>
<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(0)}" class="fj-axis"/>
<line x1="${x(0)}" y1="${y(0)}" x2="${x(0)}" y2="${y(1)}" class="fj-axis"/>
<text x="${size / 2}" y="${size - 6}" class="fj-label" text-anchor="middle">your probability</text>
<text x="10" y="${size / 2}" class="fj-label" text-anchor="middle" transform="rotate(-90 10 ${size / 2})">how often it happened</text>
${dots}</svg>`;
}
