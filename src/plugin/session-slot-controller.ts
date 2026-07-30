import streamDeck, { type KeyAction, type WillAppearEvent } from "@elgato/streamdeck";

import {
  SESSION_REDUCER_ACTION,
  createSessionState,
  deriveSlotColor,
  reduceSessionState,
  SESSION_REDUCER_LIMITS,
  type SessionState,
} from "../core/reducer";
import { SESSION_COLOR_LIMITS, SESSION_SLOT_COLOR, type SessionSlotColor } from "../core/colors";
import { SESSION_STATUS, type LocalAgentStatusEvent } from "../core/types";

const SESSION_SLOT_IMAGE = {
  PREFIX: "data:image/svg+xml,",
  SIZE: 72,
  ROW: 0,
} as const;

const SESSION_SLOT_RENDER_RESULT = {
  SKIPPED: "skipped",
  RENDERED: "rendered",
  FAILED: "failed",
} as const;

type SessionSlotRenderResult = (typeof SESSION_SLOT_RENDER_RESULT)[keyof typeof SESSION_SLOT_RENDER_RESULT];

export const SESSION_SLOT_RENDER_RETRY_DELAY_MS = 50;
export const SESSION_SLOT_RENDER_ERROR = "Session slot render failed.";

export interface SessionSlotClock {
  now(): number;
}

export interface SessionSlotScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface SessionSlotLogger {
  error(message: string): void;
}

export interface SessionSlotControllerOptions {
  readonly clock: SessionSlotClock;
  readonly scheduler: SessionSlotScheduler;
  readonly logger: SessionSlotLogger;
}

const productionControllerOptions: SessionSlotControllerOptions = {
  clock: { now: Date.now },
  scheduler: {
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  logger: {
    error: (message) => streamDeck.logger.error(message),
  },
};

interface VisibleSessionSlot {
  readonly action: KeyAction;
  readonly slotIndex: number;
  renderGeneration: number;
  advisoryGeneration: number;
  retryGeneration: number;
  renderedColor?: SessionSlotColor;
  advisoryTimer?: unknown;
  retryTimer?: unknown;
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

  constructor(private readonly options: SessionSlotControllerOptions = productionControllerOptions) {}

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
    const priorVisible = this.#visibleActions.get(action.id);
    if (priorVisible !== undefined) this.#cancelVisibleWork(priorVisible);
    const visible: VisibleSessionSlot = { action, slotIndex, renderGeneration: 0, advisoryGeneration: 0, retryGeneration: 0 };
    this.#visibleActions.set(action.id, visible);
    await this.#refreshVisible(visible, this.#state, true, this.options.clock.now());
  }

  unregisterVisibleAction(contextId: string): void {
    const visible = this.#visibleActions.get(contextId);
    if (visible === undefined) return;
    this.#cancelVisibleWork(visible);
    this.#visibleActions.delete(contextId);
  }

  async handleStatusEvent(event: LocalAgentStatusEvent, now: number): Promise<void> {
    this.#state = reduceSessionState(this.#state, { kind: SESSION_REDUCER_ACTION.EVENT, event });
    await this.refresh(now);
  }

  async refresh(now: number): Promise<void> {
    await Promise.all([...this.#visibleActions.values()].map((visible) => this.#refreshVisible(visible, this.#state, false, now)));
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

  dispose(): void {
    for (const visible of this.#visibleActions.values()) this.#cancelVisibleWork(visible);
    this.#visibleActions.clear();
  }

  async #refreshVisible(visible: VisibleSessionSlot, state: SessionState, force: boolean, now: number): Promise<void> {
    this.#cancelAdvisory(visible);
    this.#cancelRetry(visible);
    const generation = visible.renderGeneration + 1;
    visible.renderGeneration = generation;
    const renderResult = await this.#renderVisible(visible, state, force, now, generation);
    if (renderResult === SESSION_SLOT_RENDER_RESULT.FAILED) {
      this.#logRenderFailure();
      this.#scheduleRetry(visible, generation);
      return;
    }
    if (this.#visibleActions.get(visible.action.id) !== visible || visible.renderGeneration !== generation) return;
    const freshNow = Math.max(now, this.options.clock.now());
    if (this.#scheduleDeadlineRefresh(visible, state, freshNow, generation)) return;
    this.#scheduleAdvisory(visible, state, freshNow, generation);
  }

  #scheduleDeadlineRefresh(visible: VisibleSessionSlot, state: SessionState, now: number, renderGeneration: number): boolean {
    const slot = state.slots[visible.slotIndex];
    const deadline = slot?.runningSince === undefined ? undefined : slot.runningSince + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS;
    const isRunning = slot?.lifecycle === SESSION_STATUS.STARTED || slot?.lifecycle === SESSION_STATUS.RUNNING;
    if (!isRunning || visible.renderedColor !== SESSION_SLOT_COLOR.AMBER || deadline === undefined || now < deadline) return false;
    this.#cancelAdvisory(visible);
    const generation = visible.advisoryGeneration + 1;
    visible.advisoryGeneration = generation;
    visible.advisoryTimer = this.options.scheduler.schedule(() => {
      if (visible.advisoryGeneration !== generation || visible.renderGeneration !== renderGeneration || this.#visibleActions.get(visible.action.id) !== visible) return;
      visible.advisoryTimer = undefined;
      void this.#refreshVisible(visible, this.#state, false, Math.max(this.options.clock.now(), deadline));
    }, 0);
    return true;
  }

  #scheduleAdvisory(visible: VisibleSessionSlot, state: SessionState, now: number, renderGeneration: number): void {
    if (this.#visibleActions.get(visible.action.id) !== visible || visible.renderGeneration !== renderGeneration) return;
    const slot = state.slots[visible.slotIndex];
    if (slot?.lifecycle !== SESSION_STATUS.STARTED && slot?.lifecycle !== SESSION_STATUS.RUNNING) return;
    if (slot.runningSince === undefined || deriveSlotColor(slot, now) !== SESSION_SLOT_COLOR.AMBER) return;
    const deadline = slot.runningSince + SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS;
    if (now >= deadline) return;
    this.#cancelAdvisory(visible);
    const generation = visible.advisoryGeneration + 1;
    visible.advisoryGeneration = generation;
    visible.advisoryTimer = this.options.scheduler.schedule(() => {
      if (visible.advisoryGeneration !== generation || visible.renderGeneration !== renderGeneration || this.#visibleActions.get(visible.action.id) !== visible) return;
      visible.advisoryTimer = undefined;
      void this.#refreshVisible(visible, this.#state, false, this.options.clock.now());
    }, deadline - now);
  }

  #cancelAdvisory(visible: VisibleSessionSlot): void {
    if (visible.advisoryTimer === undefined) return;
    this.options.scheduler.cancel(visible.advisoryTimer);
    visible.advisoryTimer = undefined;
    visible.advisoryGeneration += 1;
  }

  #scheduleRetry(visible: VisibleSessionSlot, renderGeneration: number): void {
    if (this.#visibleActions.get(visible.action.id) !== visible || visible.renderGeneration !== renderGeneration) return;
    this.#cancelRetry(visible);
    const retryGeneration = visible.retryGeneration + 1;
    visible.retryGeneration = retryGeneration;
    visible.retryTimer = this.options.scheduler.schedule(() => {
      if (visible.retryGeneration !== retryGeneration || visible.renderGeneration !== renderGeneration || this.#visibleActions.get(visible.action.id) !== visible) return;
      visible.retryTimer = undefined;
      void this.#retryRender(visible, renderGeneration);
    }, SESSION_SLOT_RENDER_RETRY_DELAY_MS);
  }

  async #retryRender(visible: VisibleSessionSlot, generation: number): Promise<void> {
    const now = this.options.clock.now();
    const renderResult = await this.#renderVisible(visible, this.#state, false, now, generation);
    if (renderResult === SESSION_SLOT_RENDER_RESULT.FAILED) {
      this.#logRenderFailure();
      return;
    }
    if (this.#visibleActions.get(visible.action.id) !== visible || visible.renderGeneration !== generation) return;
    if (this.#scheduleDeadlineRefresh(visible, this.#state, now, generation)) return;
    this.#scheduleAdvisory(visible, this.#state, now, generation);
  }

  #cancelRetry(visible: VisibleSessionSlot): void {
    if (visible.retryTimer !== undefined) {
      this.options.scheduler.cancel(visible.retryTimer);
      visible.retryTimer = undefined;
    }
    visible.retryGeneration += 1;
  }

  #cancelVisibleWork(visible: VisibleSessionSlot): void {
    this.#cancelAdvisory(visible);
    this.#cancelRetry(visible);
  }

  #logRenderFailure(): void {
    try {
      this.options.logger.error(SESSION_SLOT_RENDER_ERROR);
    } catch {
      // Logging must not interfere with local rendering recovery.
    }
  }

  async #renderVisible(
    visible: VisibleSessionSlot,
    state: SessionState,
    force: boolean,
    now: number,
    generation: number,
  ): Promise<SessionSlotRenderResult> {
    const color = deriveSlotColor(state.slots[visible.slotIndex], now);
    if (!force && visible.renderedColor === color) return SESSION_SLOT_RENDER_RESULT.SKIPPED;
    try {
      await visible.action.setImage(sessionSlotSvgDataUri(color));
    } catch {
      return SESSION_SLOT_RENDER_RESULT.FAILED;
    }
    if (this.#visibleActions.get(visible.action.id) === visible && visible.renderGeneration === generation) {
      visible.renderedColor = color;
    }
    return SESSION_SLOT_RENDER_RESULT.RENDERED;
  }

}

export const sessionSlotController = new SessionSlotController();
