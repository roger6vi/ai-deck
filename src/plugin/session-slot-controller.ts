import type { KeyAction, WillAppearEvent } from "@elgato/streamdeck";

import {
  SESSION_REDUCER_ACTION,
  createSessionState,
  deriveSlotColor,
  reduceSessionState,
  SESSION_REDUCER_LIMITS,
  type SessionState,
} from "../core/reducer";
import { SESSION_SLOT_COLOR, type SessionSlotColor } from "../core/colors";
import type { LocalAgentStatusEvent } from "../core/types";

const SESSION_SLOT_IMAGE = {
  PREFIX: "data:image/svg+xml,",
  SIZE: 72,
  ROW: 0,
} as const;

interface VisibleSessionSlot {
  readonly action: KeyAction;
  readonly slotIndex: number;
  renderGeneration: number;
  renderedColor?: SessionSlotColor;
}

function isSlotIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < SESSION_REDUCER_LIMITS.SLOT_COUNT;
}

function slotIndexFor(event: WillAppearEvent): number | undefined {
  if (event.payload.controller !== "Keypad") return undefined;
  const coordinates = event.action instanceof Object && "coordinates" in event.action
    ? (event.action as KeyAction).coordinates
    : undefined;
  if (coordinates?.row !== SESSION_SLOT_IMAGE.ROW || !isSlotIndex(coordinates?.column ?? -1)) return undefined;
  return coordinates.column;
}

export function sessionSlotSvgDataUri(color: SessionSlotColor): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SESSION_SLOT_IMAGE.SIZE} ${SESSION_SLOT_IMAGE.SIZE}"><rect width="${SESSION_SLOT_IMAGE.SIZE}" height="${SESSION_SLOT_IMAGE.SIZE}" fill="${color}"/></svg>`;
  return `${SESSION_SLOT_IMAGE.PREFIX}${encodeURIComponent(svg)}`;
}

export class SessionSlotController {
  #state = createSessionState();
  #visibleActions = new Map<string, VisibleSessionSlot>();

  get state(): SessionState {
    return this.#state;
  }

  get visibleContextCount(): number {
    return this.#visibleActions.size;
  }

  async registerVisibleAction(event: WillAppearEvent): Promise<void> {
    const slotIndex = slotIndexFor(event);
    if (slotIndex === undefined) return;
    const action = event.action as KeyAction;
    const visible: VisibleSessionSlot = { action, slotIndex, renderGeneration: 0 };
    this.#visibleActions.set(action.id, visible);
    await this.#renderVisible(visible, this.#state, true);
  }

  unregisterVisibleAction(contextId: string): void {
    this.#visibleActions.delete(contextId);
  }

  async handleStatusEvent(event: LocalAgentStatusEvent, now: number): Promise<void> {
    this.#state = reduceSessionState(this.#state, { kind: SESSION_REDUCER_ACTION.EVENT, event });
    await this.refresh(now);
  }

  async refresh(now: number): Promise<void> {
    await Promise.all([...this.#visibleActions.values()].map((visible) => this.#renderVisible(visible, this.#state, false, now)));
  }

  async handlePhysicalKeyDown(contextId: string, now: number): Promise<void> {
    const visible = this.#visibleActions.get(contextId);
    if (visible === undefined) return;
    this.#state = reduceSessionState(this.#state, {
      kind: SESSION_REDUCER_ACTION.PHYSICAL_KEY_DOWN,
      slotIndex: visible.slotIndex,
    });
    await this.refresh(now);
  }

  async #renderVisible(
    visible: VisibleSessionSlot,
    state: SessionState,
    force: boolean,
    now = 0,
  ): Promise<void> {
    const color = deriveSlotColor(state.slots[visible.slotIndex], now);
    if (!force && visible.renderedColor === color) return;
    const generation = visible.renderGeneration + 1;
    visible.renderGeneration = generation;
    try {
      await visible.action.setImage(sessionSlotSvgDataUri(color));
    } catch {
      return;
    }
    if (this.#visibleActions.get(visible.action.id) === visible && visible.renderGeneration === generation) {
      visible.renderedColor = color;
    }
  }
}

export const sessionSlotController = new SessionSlotController();
