import streamDeck from "@elgato/streamdeck";

import { SessionSlotAction } from "./actions/session-slot";

const LAUNCH_PARAMETERS = {
  PORT: "-port",
  PLUGIN_UUID: "-pluginUUID",
  REGISTER_EVENT: "-registerEvent",
  INFO: "-info",
} as const;
const missingParameters = Object.values(LAUNCH_PARAMETERS).filter(
  (parameter) => !process.argv.includes(parameter),
);

if (missingParameters.length > 0) {
  console.error(
    `AI Deck launch parameter error: Unable to establish a connection with Stream Deck, missing command line arguments: ${missingParameters.join(", ")}`,
  );
  process.exitCode = 1;
} else {
  streamDeck.actions.registerAction(new SessionSlotAction());
  void streamDeck.connect().catch((error: unknown) => {
    console.error("AI Deck launch parameter error:", error instanceof Error ? error.message : error);
    streamDeck.logger.error("Stream Deck connection failed.", error);
    process.exitCode = 1;
  });
}
