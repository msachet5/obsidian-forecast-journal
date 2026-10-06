import { App, TFile, normalizePath } from "obsidian";
import { Forecast, Outcome, slug } from "./scoring";

// Each forecast is a note in the forecasts folder with YAML frontmatter, so it stays readable,
// searchable and linkable like any other note.

export function toForecast(file: TFile, fm: Record<string, unknown>): Forecast | null {
	if (fm?.type !== "forecast") return null;
	const p = Number(fm.probability);
	if (!Number.isFinite(p)) return null;
	const base = fm.baseline === undefined || fm.baseline === null || fm.baseline === "" ? null : Number(fm.baseline);
	const outcome = String(fm.outcome ?? "").toLowerCase();
	return {
		id: file.basename,
		question: String(fm.question ?? file.basename),
		probability: p > 1 ? p / 100 : p,
		baseline: base === null || !Number.isFinite(base) ? null : base > 1 ? base / 100 : base,
		created: String(fm.created ?? ""),
		resolveBy: fm.resolve_by ? String(fm.resolve_by) : null,
		outcome: (["yes", "no", "void"].includes(outcome) ? outcome : null) as Outcome,
		resolvedOn: fm.resolved_on ? String(fm.resolved_on) : null,
		tags: Array.isArray(fm.tags) ? fm.tags.map(String) : fm.tags ? [String(fm.tags)] : [],
		path: file.path,
	};
}

export function loadForecasts(app: App, folder: string): Forecast[] {
	const prefix = normalizePath(folder) + "/";
	const out: Forecast[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		if (!file.path.startsWith(prefix)) continue;
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		const f = toForecast(file, fm as Record<string, unknown>);
		if (f) out.push(f);
	}
	return out;
}

export async function createForecast(
	app: App,
	folder: string,
	f: { question: string; probability: number; baseline: number | null; resolveBy: string | null; tags: string[]; reasoning: string },
): Promise<TFile> {
	const dir = normalizePath(folder);
	if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
	const today = new Date().toISOString().slice(0, 10);
	let path = normalizePath(`${dir}/${today} ${slug(f.question)}.md`);
	let i = 2;
	while (app.vault.getAbstractFileByPath(path)) path = normalizePath(`${dir}/${today} ${slug(f.question)} ${i++}.md`);
	const yaml = [
		"---",
		"type: forecast",
		`question: ${JSON.stringify(f.question)}`,
		`probability: ${f.probability}`,
		`baseline: ${f.baseline ?? ""}`,
		`created: ${today}`,
		`resolve_by: ${f.resolveBy ?? ""}`,
		"outcome: ",
		"resolved_on: ",
		`tags: [${f.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
		"---",
		"",
		`# ${f.question}`,
		"",
		`**My probability:** ${Math.round(f.probability * 100)}%` + (f.baseline !== null ? ` · **Baseline:** ${Math.round(f.baseline * 100)}%` : ""),
		"",
		"## Reasoning",
		"",
		f.reasoning || "",
		"",
		"## What would change my mind",
		"",
		"",
		"## Resolution notes",
		"",
	].join("\n");
	return app.vault.create(path, yaml);
}

export async function resolveForecast(app: App, path: string, outcome: Outcome): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return;
	await app.fileManager.processFrontMatter(file, (fm) => {
		fm.outcome = outcome;
		fm.resolved_on = new Date().toISOString().slice(0, 10);
	});
}
