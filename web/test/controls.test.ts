import { describe, expect, test } from "bun:test";
import { bindVolume, setUpMenu, setUpSheet, type MenuItems } from "../src/controls";

// Stand-ins for the page's elements, with just what the controls use. Events don't
// bubble here, so a click "elsewhere" is dispatched on the root itself.

class FakeElement extends EventTarget {
  hidden = false;
  focused = false;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  contains(node: unknown): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.dispatchEvent(new Event("click"));
  }
}

class FakeDialog extends FakeElement {
  open = false;

  showModal() {
    this.open = true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
}

class FakeSlider extends FakeElement {
  valueAsNumber = 0;

  slide(value: number) {
    this.valueAsNumber = value;
    this.dispatchEvent(new Event("input"));
  }
}

/** A click on `target` that has bubbled up to wherever it's dispatched. */
function clickOn(target: FakeElement): Event {
  const event = new Event("click");
  Object.defineProperty(event, "target", { value: target });
  return event;
}

function keydown(key: string): Event {
  return Object.assign(new Event("keydown"), { key });
}

function menu() {
  const root = new FakeElement();
  const button = new FakeElement();
  const list = new FakeElement();
  const settings = { item: new FakeElement(), sheet: new FakeDialog(), close: new FakeElement() };
  const about = { item: new FakeElement(), sheet: new FakeDialog(), close: new FakeElement() };
  list.children.push(settings.item, about.item);
  const items = [settings, about].map(({ item, sheet, close }) => [item, sheet, close]) as unknown as MenuItems;
  setUpMenu(root, button as unknown as HTMLElement, list as unknown as HTMLElement, items);
  return { root, button, list, settings, about };
}

describe("menu", () => {
  test("starts hidden, and its button shows and hides it", () => {
    const { button, list } = menu();
    expect(list.hidden).toBe(true);
    expect(button.attributes.get("aria-expanded")).toBe("false");

    button.click();
    expect(list.hidden).toBe(false);
    expect(button.attributes.get("aria-expanded")).toBe("true");

    button.click();
    expect(list.hidden).toBe(true);
  });

  test("each item hides the menu and opens its sheet", () => {
    const { button, list, settings, about } = menu();
    button.click();
    settings.item.click();
    expect(list.hidden).toBe(true);
    expect(settings.sheet.open).toBe(true);
    expect(about.sheet.open).toBe(false);

    settings.sheet.close();
    button.click();
    about.item.click();
    expect(about.sheet.open).toBe(true);
  });

  test("closing a sheet returns focus to the menu's button", () => {
    const { button, about } = menu();
    button.click();
    about.item.click();
    expect(button.focused).toBe(false);

    about.close.click();
    expect(button.focused).toBe(true);
  });

  test("a click elsewhere hides it; a click in it doesn't", () => {
    const { root, button, list, settings } = menu();
    button.click();
    root.dispatchEvent(clickOn(settings.item));
    expect(list.hidden).toBe(false);

    root.click();
    expect(list.hidden).toBe(true);
    expect(button.attributes.get("aria-expanded")).toBe("false");
  });

  test("Escape hides it and returns focus to its button", () => {
    const { root, button, list } = menu();
    root.dispatchEvent(keydown("Escape"));
    expect(button.focused).toBe(false);

    button.click();
    root.dispatchEvent(keydown("Enter"));
    expect(list.hidden).toBe(false);
    root.dispatchEvent(keydown("Escape"));
    expect(list.hidden).toBe(true);
    expect(button.focused).toBe(true);
  });
});

describe("sheet", () => {
  function sheet() {
    const dialog = new FakeDialog();
    const close = new FakeElement();
    const contents = new FakeElement();
    setUpSheet(dialog as unknown as HTMLDialogElement, close as unknown as HTMLElement);
    dialog.showModal();
    return { dialog, close, contents };
  }

  test("its close button closes it", () => {
    const { dialog, close } = sheet();
    close.click();
    expect(dialog.open).toBe(false);
  });

  test("a click on the backdrop closes it; a click on its contents doesn't", () => {
    const { dialog, contents } = sheet();
    dialog.dispatchEvent(clickOn(contents));
    expect(dialog.open).toBe(true);

    dialog.click();
    expect(dialog.open).toBe(false);
  });
});

describe("volume sliders", () => {
  function player(volume: number) {
    const listeners: (() => void)[] = [];
    return {
      volume,
      setVolume(value: number) {
        this.volume = value;
        for (const listener of listeners) listener();
      },
      subscribe(listener: () => void) {
        listeners.push(listener);
      },
    };
  }

  test("start at the player's volume, and each one moves the other", () => {
    const bar = new FakeSlider();
    const settings = new FakeSlider();
    const volume = player(0.6);
    bindVolume([bar, settings] as unknown as HTMLInputElement[], volume);
    expect(bar.valueAsNumber).toBe(0.6);
    expect(settings.valueAsNumber).toBe(0.6);

    settings.slide(0.25);
    expect(volume.volume).toBe(0.25);
    expect(bar.valueAsNumber).toBe(0.25);

    bar.slide(0.9);
    expect(settings.valueAsNumber).toBe(0.9);
  });

  test("follow volume changes from elsewhere", () => {
    const slider = new FakeSlider();
    const volume = player(1);
    bindVolume([slider] as unknown as HTMLInputElement[], volume);
    volume.setVolume(0.4);
    expect(slider.valueAsNumber).toBe(0.4);
  });
});
