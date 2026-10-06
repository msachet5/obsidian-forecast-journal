import { App, ItemView, MarkdownRenderChild, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import { Forecast, due, parseProbability, reliabilitySvg, score } from "./scoring";
import { createForecast, loadForecasts, resolveForecast } from "./store";

interface Settings {
	folder: string;
	bins: number;
}

const DEFAULTS: Settings = { folder: "Forecasts", bins: 10 };
const VIEW = "forecast-journal-view";

const pct = (v: number | null, d = 0) => (v === null ? "n/a" : `${(v * 100).toFixed(d)}%`);
const num = (v: number | null, d = 3) => (v === null ? "n/a" : v.toFixed(d));

function renderStats(el: HTMLElement, fs: Forecast[], bins: number, tag?: string): void {
	const subset = tag ? fs.filter((f) => f.tags.includes(tag)) : fs;
	const s = score(subset, bins);
	el.empty();
	el.addClass("fj-stats");
	const cards = el.createDiv({ cls: "fj-cards" });
	const card = (value: string, label: string, title = "") => {
		const c = cards.createDiv({ cls: "fj-card", attr: { title } });
		c.createEl("b", { text: value });
		c.createEl("span", { text: label });
	};
	card(String(subset.length), "forecasts logged");
	card(String(s.resolved), "resolved");
	card(num(s.brier), "Brier score", "Mean of (probability - outcome)^2. 0 is perfect; 0.25 is always saying 50%.");
	card(pct(s.skillVsCoinFlip), "skill vs always 50%");
	if (s.valueAdded !== null) {
		card(
			(s.valueAdded >= 0 ? "+" : "") + num(s.valueAdded),
			"value added vs baseline",
			"Baseline Brier minus your Brier on forecasts that recorded a baseline. Positive: your judgment improved on the base rate or model.",
		);
	}
	if (s.overconfidence !== null) {
		card((s.overconfidence >= 0 ? "+" : "") + num(s.overconfidence, 2), s.overconfidence > 0.02 ? "overconfident" : s.overconfidence < -0.02 ? "underconfident" : "well calibrated");
	}
	if (s.bins.length) {
		const chart = el.createDiv({ cls: "fj-chart" });
		chart.innerHTML = reliabilitySvg(s.bins);
		const table = el.createEl("table", { cls: "fj-table" });
		const head = table.createEl("tr");
		["Your probability", "Forecasts", "Average forecast", "Came true"].forEach((h) => head.createEl("th", { text: h }));
		for (const b of s.bins) {
			const r = table.createEl("tr");
			r.createEl("td", { text: `${Math.round(b.lower * 100)}-${Math.round(b.upper * 100)}%` });
			r.createEl("td", { text: String(b.count) });
			r.createEl("td", { text: pct(b.meanForecast) });
			r.createEl("td", { text: pct(b.observedRate) });
		}
	} else {
		el.createEl("p", { text: "Resolve a few forecasts to see your calibration.", cls: "fj-muted" });
	}
}

class ForecastModal extends Modal {
	constructor(app: App, private plugin: ForecastJournal) {
		super(app);
	}
	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Log a forecast" });
		const v = { question: "", probability: "", baseline: "", resolveBy: "", tags: "", reasoning: "" };
		new Setting(contentEl).setName("Question").setDesc("Phrase it so it resolves clearly yes or no.").addTextArea((t) => t.onChange((x) => (v.question = x)));
		new Setting(contentEl).setName("Your probability").setDesc("e.g. 70% or 0.7").addText((t) => t.onChange((x) => (v.probability = x)));
		new Setting(contentEl).setName("Baseline (optional)").setDesc("Base rate, model or market probability, to measure whether your judgment adds value.").addText((t) => t.onChange((x) => (v.baseline = x)));
		new Setting(contentEl).setName("Resolve by").addText((t) => {
			t.inputEl.type = "date";
			t.onChange((x) => (v.resolveBy = x));
		});
		new Setting(contentEl).setName("Tags").setDesc("comma separated, e.g. work, markets").addText((t) => t.onChange((x) => (v.tags = x)));
		new Setting(contentEl).setName("Reasoning").addTextArea((t) => t.onChange((x) => (v.reasoning = x)));
		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Save").setCta().onClick(async () => {
				const p = parseProbability(v.probability);
				const base = v.baseline.trim() ? parseProbability(v.baseline) : null;
				if (!v.question.trim() || p === null || (v.baseline.trim() && base === null)) {
					new Notice("Need a question and a probability between 0 and 100%.");
					return;
				}
				const file = await createForecast(this.app, this.plugin.settings.folder, {
					question: v.question.trim(),
					probability: p,
					baseline: base,
					resolveBy: v.resolveBy || null,
					tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean),
					reasoning: v.reasoning,
				});
				new Notice(`Forecast saved: ${file.basename}`);
				this.close();
			}),
		);
	}
	onClose(): void {
		this.contentEl.empty();
	}
}

class ResolveModal extends Modal {
	constructor(app: App, private plugin: ForecastJournal, private items: Forecast[]) {
		super(app);
	}
	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: `Forecasts due (${this.items.length})` });
		if (!this.items.length) contentEl.createEl("p", { text: "Nothing is due. Nice." });
		for (const f of this.items) {
			const s = new Setting(contentEl).setName(f.question).setDesc(`${pct(f.probability)} · due ${f.resolveBy}`);
			for (const o of ["yes", "no", "void"] as const) {
				s.addButton((b) =>
					b.setButtonText(o).onClick(async () => {
						await resolveForecast(this.app, f.path as string, o);
						s.settingEl.addClass("fj-done");
						s.setDesc(`resolved: ${o}`);
					}),
				);
			}
		}
	}
	onClose(): void {
		this.contentEl.empty();
		this.plugin.refreshViews();
	}
}

class JournalView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: ForecastJournal) {
		super(leaf);
	}
	getViewType(): string {
		return VIEW;
	}
	getDisplayText(): string {
		return "Forecast journal";
	}
	getIcon(): string {
		return "target";
	}
	async onOpen(): Promise<void> {
		this.render();
	}
	render(): void {
		const el = this.contentEl;
		el.empty();
		el.createEl("h4", { text: "Forecast journal" });
		const fs = loadForecasts(this.app, this.plugin.settings.folder);
		const statsEl = el.createDiv();
		renderStats(statsEl, fs, this.plugin.settings.bins);
		const today = new Date().toISOString().slice(0, 10);
		const d = due(fs, today);
		el.createEl("h5", { text: `Due to resolve (${d.length})` });
		const list = el.createEl("ul");
		for (const f of d) {
			const li = list.createEl("li");
			const a = li.createEl("a", { text: f.question, href: "#" });
			a.onclick = (e) => {
				e.preventDefault();
				this.app.workspace.openLinkText(f.path as string, "", false);
			};
			li.appendText(` · ${pct(f.probability)} · due ${f.resolveBy}`);
		}
	}
}

export default class ForecastJournal extends Plugin {
	settings: Settings = DEFAULTS;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULTS, await this.loadData());
		this.registerView(VIEW, (leaf) => new JournalView(leaf, this));
		this.addRibbonIcon("target", "Forecast journal", () => this.openView());
		this.addCommand({ id: "log-forecast", name: "Log a forecast", callback: () => new ForecastModal(this.app, this).open() });
		this.addCommand({
			id: "resolve-due",
			name: "Resolve due forecasts",
			callback: () => {
				const fs = loadForecasts(this.app, this.settings.folder);
				new ResolveModal(this.app, this, due(fs, new Date().toISOString().slice(0, 10))).open();
			},
		});
		this.addCommand({ id: "open-journal", name: "Open calibration view", callback: () => this.openView() });
		this.registerMarkdownCodeBlockProcessor("forecast-journal", (source, el, ctx) => {
			const tag = /tag:\s*(\S+)/.exec(source)?.[1];
			const child = new MarkdownRenderChild(el);
			ctx.addChild(child);
			const draw = () => renderStats(el, loadForecasts(this.app, this.settings.folder), this.settings.bins, tag);
			draw();
			child.registerEvent(this.app.metadataCache.on("resolved", draw));
		});
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.refreshViews()));
		this.addSettingTab(new JournalSettings(this.app, this));
	}

	async openView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW);
		if (existing.length) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
			const view = leaf.view;
			if (view instanceof JournalView) view.render();
		}
	}
}

class JournalSettings extends PluginSettingTab {
	constructor(app: App, private plugin: ForecastJournal) {
		super(app, plugin);
	}
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName("Forecasts folder")
			.setDesc("Each forecast is saved as a note here.")
			.addText((t) =>
				t.setValue(this.plugin.settings.folder).onChange(async (v) => {
					this.plugin.settings.folder = v.trim() || DEFAULTS.folder;
					await this.plugin.saveData(this.plugin.settings);
				}),
			);
		new Setting(containerEl)
			.setName("Calibration bins")
			.addDropdown((d) =>
				d.addOptions({ "5": "5", "10": "10" }).setValue(String(this.plugin.settings.bins)).onChange(async (v) => {
					this.plugin.settings.bins = Number(v);
					await this.plugin.saveData(this.plugin.settings);
				}),
			);
	}
}
