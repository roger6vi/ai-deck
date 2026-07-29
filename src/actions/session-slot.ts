import { action, SingletonAction } from "@elgato/streamdeck";

import { SESSION_SLOT_ACTION_UUID } from "./session-slot.constants";

export { SESSION_SLOT_ACTION_UUID } from "./session-slot.constants";

@action({ UUID: SESSION_SLOT_ACTION_UUID })
export class SessionSlotAction extends SingletonAction {
  // This scaffold action intentionally performs no work yet.
  override onWillAppear(): void {}
}
