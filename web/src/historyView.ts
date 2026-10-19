import { currentLocale, t } from "./l10n";
import { historyDays, type ListeningHistory } from "./listeningHistory";
import { NOISE_INFO, NOISE_TYPES } from "./noiseType";

/** Shared ordering across platforms: white, pink, brown, waves, fan. Equal RGB components only. */
const SHADES = ["#333333", "#666666", "#999999", "#bbbbbb", "#eeeeee"];

export function setUpHistory(history: ListeningHistory): () => void {
  const content = document.getElementById("history-content")!;
  const dialog = document.getElementById("history") as HTMLDialogElement;
  let offset = 0;
  const controls = document.createElement("div");
  controls.className = "history-navigation";
  const previous = document.createElement("button");
  const today = document.createElement("button");
  const next = document.createElement("button");
  controls.append(previous, today, next);
  const range = document.createElement("p");
  range.className = "history-range";
  const chart = document.createElement("div");
  const empty = document.createElement("p");
  const legend = document.createElement("ul");
  legend.className = "history-legend";
  const note = document.createElement("p");
  const failure = document.createElement("p");
  failure.setAttribute("role", "status");
  content.append(controls, range, chart, empty, legend, note, failure);
  previous.onclick = () => { offset -= 7; render(); };
  next.onclick = () => { offset = Math.min(0, offset + 7); render(); };
  today.onclick = () => { offset = 0; render(); };

  function render(): void {
    const now = new Date();
    const days = historyDays(history.snapshot(), new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
    const locale = currentLocale().tag;
    const date = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    const fullDate = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    previous.textContent = t("history_previous");
    today.textContent = t("history_today");
    next.textContent = t("history_next");
    next.disabled = offset === 0;
    range.textContent = `${fullDate.format(days[0]!.start)} – ${fullDate.format(days[6]!.start)}`;
    note.textContent = t("history_local");
    failure.textContent = history.storageFailed ? t("history_storage_failed") : "";
    const totals = days.map((day) => NOISE_TYPES.reduce((sum, type) => sum + day.minutes[type], 0));
    const max = Math.max(1, Math.ceil(Math.max(...totals)));
    empty.textContent = totals.every((value) => value === 0) ? t("history_empty") : "";

    // SVG text is escaped by textContent; localized strings never become HTML.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 560 280");
    svg.classList.add("history-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("history"));
    const title = document.createElementNS(svg.namespaceURI, "desc");
    title.setAttribute("id", "history-chart-values");
    svg.setAttribute("aria-describedby", "history-chart-values");
    title.textContent = days.map((day) => `${fullDate.format(day.start)}. ${NOISE_TYPES.map((type) =>
      t("history_value", { noise: t(NOISE_INFO[type].title), minutes: number.format(day.minutes[type]) })).join("; ")}`).join(". ");
    svg.append(title);
    const add = (tag: string, attributes: Record<string, string | number>, text?: string) => {
      const element = document.createElementNS(svg.namespaceURI, tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
      if (text !== undefined) element.textContent = text;
      svg.append(element);
      return element;
    };
    add("text", { x: 4, y: 16, fill: "currentColor", "font-size": 13 }, t("history_minutes"));
    for (let index = 0; index <= 4; index++) {
      const y = 220 - index * 45;
      add("line", { x1: 52, x2: 554, y1: y, y2: y, stroke: "currentColor", opacity: 0.18 });
      add("text", { x: 46, y: y + 4, "text-anchor": "end", fill: "currentColor", "font-size": 12 }, number.format(max * index / 4));
    }
    days.forEach((day, index) => {
      let y = 220;
      NOISE_TYPES.forEach((type, sound) => {
        const height = day.minutes[type] / max * 180;
        y -= height;
        if (height > 0) add("rect", { x: 65 + index * 71, y, width: 40, height, fill: SHADES[sound]!, stroke: "currentColor", "stroke-width": 0.5 });
      });
      add("text", { x: 85 + index * 71, y: 242, "text-anchor": "middle", fill: "currentColor", "font-size": 11 }, date.format(day.start));
    });
    add("text", { x: 300, y: 272, "text-anchor": "middle", fill: "currentColor", "font-size": 13 }, t("history_date"));
    chart.replaceChildren(svg);
    legend.replaceChildren(...NOISE_TYPES.map((type, index) => {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "history-swatch";
      swatch.style.background = SHADES[index]!;
      swatch.setAttribute("aria-hidden", "true");
      item.append(swatch, t("history_value", {
        noise: t(NOISE_INFO[type].title), minutes: number.format(days.reduce((sum, day) => sum + day.minutes[type], 0)),
      }));
      return item;
    }));
  }
  history.subscribe(() => { if (dialog.open) render(); });
  document.getElementById("open-history")!.addEventListener("click", () => { render(); void history.refresh(); });
  setInterval(() => { if (dialog.open) render(); }, 15_000);
  return render;
}
