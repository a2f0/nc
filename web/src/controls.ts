// The page's controls besides the sounds: the three-dot menu, the sheets it opens, and
// the volume sliders.

/** The menu's items, each with the sheet it opens and that sheet's close button. */
export type MenuItems = ReadonlyArray<readonly [item: HTMLElement, sheet: HTMLDialogElement, close: HTMLElement]>;

/**
 * A button that shows and hides a menu of items, each opening a sheet. A click anywhere
 * else or Escape hides the menu.
 */
export function setUpMenu(root: EventTarget, button: HTMLElement, menu: HTMLElement, items: MenuItems): void {
  const show = (open: boolean) => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  show(false);
  // `hidden` can also be "until-found", which the menu never is.
  button.addEventListener("click", () => show(menu.hidden !== false));
  root.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (!menu.hidden && !button.contains(target) && !menu.contains(target)) show(false);
  });
  root.addEventListener("keydown", (event) => {
    if (menu.hidden || (event as KeyboardEvent).key !== "Escape") return;
    show(false);
    button.focus();
  });
  for (const [item, sheet, close] of items) {
    item.addEventListener("click", () => {
      show(false);
      sheet.showModal();
    });
    setUpSheet(sheet, close);
  }
}

/** A modal sheet that closes with its close button, a click on its backdrop, or Escape. */
export function setUpSheet(sheet: HTMLDialogElement, close: HTMLElement): void {
  close.addEventListener("click", () => sheet.close());
  // The sheet's contents fill its box, so a click on the dialog itself is on the backdrop.
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) sheet.close();
  });
}

/** What the volume sliders need of the player. */
export interface Volume {
  readonly volume: number;
  setVolume(volume: number): void;
  subscribe(listener: () => void): void;
}

/** Sliders that each set the player's volume, and all show it. */
export function bindVolume(sliders: readonly HTMLInputElement[], player: Volume): void {
  const show = () => {
    for (const slider of sliders) slider.valueAsNumber = player.volume;
  };
  for (const slider of sliders) {
    slider.addEventListener("input", () => player.setVolume(slider.valueAsNumber));
  }
  player.subscribe(show);
  show();
}
