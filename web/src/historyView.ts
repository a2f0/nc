import { currentLocale, t } from "./l10n";
import { historyDays, historyTotals, type ListeningHistory } from "./listeningHistory";
import { NOISE_INFO, NOISE_TYPES, type NoiseType } from "./noiseType";

/** Shared ordering across platforms: white, pink, brown, waves, fan. Equal RGB components only. */
const SHADES = NOISE_TYPES.map((type) => `var(--history-${type})`);

export function setUpHistory(history: ListeningHistory): () => void {
  const content = document.getElementById("history-content")!;
  const dialog = document.getElementById("history") as HTMLDialogElement;
  let offset = 0;
  let allTime = false;
  let selectedSound: NoiseType | null = null;
  let detailOffset = 0;
  const detail = document.createElement("div");
  detail.className = "history-detail";
  const back = document.createElement("button");
  const heading = document.createElement("h3");
  heading.tabIndex = -1;
  detail.append(back, heading);
  const views = document.createElement("div");
  views.className = "history-views";
  const allTimeButton = document.createElement("button");
  const calendarButton = document.createElement("button");
  views.append(allTimeButton, calendarButton);
  allTimeButton.onclick = () => { allTime = true; render(); };
  calendarButton.onclick = () => { allTime = false; render(); };
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
  content.append(views, detail, controls, range, chart, empty, legend, note, failure);
  const legendButtons = NOISE_TYPES.map((type, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const swatch = document.createElement("span");
    swatch.className = "history-swatch";
    swatch.style.background = SHADES[index]!;
    swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    const arrow = document.createElement("span");
    arrow.textContent = "›";
    arrow.setAttribute("aria-hidden", "true");
    button.append(swatch, label, arrow);
    button.onclick = () => {
      selectedSound = type;
      detailOffset = allTime ? 0 : offset;
      render();
      heading.focus();
    };
    item.append(button);
    legend.append(item);
    return { button, label };
  });
  back.onclick = () => {
    const index = NOISE_TYPES.indexOf(selectedSound!);
    selectedSound = null;
    render();
    legendButtons[index]!.button.focus();
  };
  const move = (value: number | null) => {
    if (selectedSound) detailOffset = value === null ? 0 : Math.min(0, detailOffset + value);
    else offset = value === null ? 0 : Math.min(0, offset + value);
    render();
  };
  previous.onclick = () => move(-7);
  next.onclick = () => move(7);
  today.onclick = () => move(null);

  function render(): void {
    const now = new Date();
    const sessions = history.snapshot().filter((session) => !selectedSound || session.soundId === selectedSound);
    const showAllTime = allTime && selectedSound === null;
    const activeOffset = selectedSound ? detailOffset : offset;
    const sounds = selectedSound ? [selectedSound] : NOISE_TYPES;
    const days = historyDays(sessions, new Date(now.getFullYear(), now.getMonth(), now.getDate() + activeOffset));
    const locale = currentLocale().tag;
    const date = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    const fullDate = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    allTimeButton.textContent = t("history_all_time");
    calendarButton.textContent = t("history_calendar");
    allTimeButton.setAttribute("aria-pressed", String(allTime));
    calendarButton.setAttribute("aria-pressed", String(!allTime));
    views.hidden = selectedSound !== null;
    detail.hidden = selectedSound === null;
    legend.hidden = selectedSound !== null;
    back.textContent = t("history_back");
    heading.textContent = selectedSound ? t("history_daily", { noise: t(NOISE_INFO[selectedSound].title) }) : "";
    controls.hidden = showAllTime;
    range.hidden = showAllTime;
    previous.textContent = t("history_previous");
    today.textContent = t("history_today");
    next.textContent = t("history_next");
    next.disabled = activeOffset === 0;
    range.textContent = `${fullDate.format(days[0]!.start)} – ${fullDate.format(days[6]!.start)}`;
    note.textContent = t("history_local");
    failure.textContent = history.storageFailed ? t("history_storage_failed") : "";
    const soundTotals = showAllTime ? historyTotals(sessions) : Object.fromEntries(NOISE_TYPES.map((type) =>
      [type, days.reduce((sum, day) => sum + day.minutes[type], 0)])) as ReturnType<typeof historyTotals>;
    const bars = showAllTime ? NOISE_TYPES.map((type) => ({
      label: t(NOISE_INFO[type].shortTitle),
      description: t("history_value", { noise: t(NOISE_INFO[type].title), minutes: number.format(soundTotals[type]) }),
      minutes: NOISE_TYPES.map((sound) => sound === type ? soundTotals[type] : 0),
    })) : days.map((day) => ({
      label: date.format(day.start),
      description: `${fullDate.format(day.start)}. ${sounds.map((type) =>
        t("history_value", { noise: t(NOISE_INFO[type].title), minutes: number.format(day.minutes[type]) })).join("; ")}`,
      minutes: NOISE_TYPES.map((type) => day.minutes[type]),
    }));
    const totals = bars.map((bar) => bar.minutes.reduce((sum, minutes) => sum + minutes, 0));
    const max = Math.max(1, Math.ceil(Math.max(...totals)));
    empty.textContent = totals.every((value) => value === 0) ? t(showAllTime ? "history_all_time_empty" : "history_empty") : "";

    // SVG text is escaped by textContent; localized strings never become HTML.
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 560 280");
    svg.classList.add("history-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", selectedSound ? heading.textContent : t("history"));
    const title = document.createElementNS(svg.namespaceURI, "desc");
    title.setAttribute("id", "history-chart-values");
    svg.setAttribute("aria-describedby", "history-chart-values");
    title.textContent = bars.map((bar) => bar.description).join(". ");
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
    const step = 497 / bars.length;
    bars.forEach((bar, index) => {
      let y = 220;
      bar.minutes.forEach((minutes, sound) => {
        const height = minutes / max * 180;
        y -= height;
        if (height > 0) add("rect", { x: 65 + index * step, y, width: step - 31, height, fill: SHADES[sound]!, stroke: "currentColor", "stroke-width": 0.5 });
      });
      add("text", { x: 65 + (step - 31) / 2 + index * step, y: 242, "text-anchor": "middle", fill: "currentColor", "font-size": 11 }, bar.label);
    });
    add("text", { x: 300, y: 272, "text-anchor": "middle", fill: "currentColor", "font-size": 13 }, t(showAllTime ? "history_sound" : "history_date"));
    chart.replaceChildren(svg);
    // Keep buttons in place so the live refresh does not discard keyboard focus.
    NOISE_TYPES.forEach((type, index) => {
      const { button, label } = legendButtons[index]!;
      label.textContent = t("history_value", {
        noise: t(NOISE_INFO[type].title), minutes: number.format(soundTotals[type]),
      });
      button.title = t("history_daily", { noise: t(NOISE_INFO[type].title) });
    });
  }
  history.subscribe(() => { if (dialog.open) render(); });
  document.getElementById("open-history")!.addEventListener("click", () => { render(); void history.refresh(); });
  setInterval(() => { if (dialog.open) render(); }, 15_000);
  return render;
}
