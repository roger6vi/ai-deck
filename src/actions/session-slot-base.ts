import { type KeyDownEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { sessionSlotController, type SessionSlotController } from "../plugin/session-slot-controller";

export class SessionSlotActionBase extends SingletonAction {
  constructor(
    private readonly controller: SessionSlotController = sessionSlotController,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  override onWillAppear(event: WillAppearEvent): Promise<void> {
    return this.controller.registerVisibleAction(event);
  }

  override onWillDisappear(event: WillDisappearEvent): void {
    this.controller.unregisterVisibleAction(event.action.id);
  }

  override onKeyDown(event: KeyDownEvent): Promise<void> {
    return this.controller.handlePhysicalKeyDown(event.action.id, this.now());
  }
}
