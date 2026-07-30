import { action } from "@elgato/streamdeck";

import { SessionSlotActionBase } from "./session-slot-base";
import { SESSION_SLOT_ACTION_UUID } from "./session-slot.constants";

export { SESSION_SLOT_ACTION_UUID } from "./session-slot.constants";

@action({ UUID: SESSION_SLOT_ACTION_UUID })
export class SessionSlotAction extends SessionSlotActionBase {}
