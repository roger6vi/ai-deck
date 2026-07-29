import streamDeck from "@elgato/streamdeck";

import { SessionSlotAction } from "./actions/session-slot";

streamDeck.actions.registerAction(new SessionSlotAction());
void streamDeck.connect().catch((error: unknown) => {
  streamDeck.logger.error("Stream Deck connection failed.", error);
  process.exitCode = 1;
});
