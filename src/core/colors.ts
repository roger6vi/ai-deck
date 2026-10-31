import { SESSION_STATUS } from "./types";
import type { SessionSlot } from "./reducer";

export const SESSION_SLOT_COLOR = {
  GRAY: "gray",
  GREEN: "green",
  AMBER: "amber",
  RED: "red",
  BLUE: "blue",
} as const;

export type SessionSlotColor = (typeof SESSION_SLOT_COLOR)[keyof typeof SESSION_SLOT_COLOR];

export const SESSION_SLOT_SVG_PAINT = Object.freeze({
  [SESSION_SLOT_COLOR.GRAY]: "#6B7280",
  [SESSION_SLOT_COLOR.GREEN]: "#006400",
  [SESSION_SLOT_COLOR.AMBER]: "#B45309",
  [SESSION_SLOT_COLOR.RED]: "#FF0000",
  [SESSION_SLOT_COLOR.BLUE]: "#0000FF",
});

export function deriveSlotColor(slot: SessionSlot | undefined, now: number): SessionSlotColor {
  if (slot === undefined || slot.sessionId === undefined || slot.lifecycle === undefined) {
    return SESSION_SLOT_COLOR.GRAY;
  }
  if (slot.lifecycle === SESSION_STATUS.ERROR) return SESSION_SLOT_COLOR.RED;
  // Baseline presence reuses the existing green: a live pane is neither a
  // running agent nor an unread result, so it must not borrow their paints.
  if (slot.lifecycle === SESSION_STATUS.IDLE) return SESSION_SLOT_COLOR.GREEN;
  if (slot.lifecycle === SESSION_STATUS.COMPLETED) {
    return slot.acknowledged ? SESSION_SLOT_COLOR.GREEN : SESSION_SLOT_COLOR.BLUE;
  }
  return SESSION_SLOT_COLOR.AMBER;
}
