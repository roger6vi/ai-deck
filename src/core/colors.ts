import { SESSION_STATUS } from "./types";
import type { SessionSlot } from "./reducer";

export const SESSION_SLOT_COLOR = {
  GREEN: "green",
  AMBER: "amber",
  RED: "red",
  BLUE: "blue",
} as const;

export type SessionSlotColor = (typeof SESSION_SLOT_COLOR)[keyof typeof SESSION_SLOT_COLOR];

export const SESSION_COLOR_LIMITS = {
  RUNNING_ADVISORY_MS: 5 * 60 * 1000,
} as const;

export function deriveSlotColor(slot: SessionSlot | undefined, now: number): SessionSlotColor {
  if (slot === undefined || slot.sessionId === undefined || slot.lifecycle === undefined) {
    return SESSION_SLOT_COLOR.GREEN;
  }
  if (slot.lifecycle === SESSION_STATUS.ERROR) return SESSION_SLOT_COLOR.RED;
  if (slot.lifecycle === SESSION_STATUS.COMPLETED) {
    return slot.acknowledged ? SESSION_SLOT_COLOR.GREEN : SESSION_SLOT_COLOR.BLUE;
  }
  if (slot.runningSince !== undefined && now - slot.runningSince >= SESSION_COLOR_LIMITS.RUNNING_ADVISORY_MS) {
    return SESSION_SLOT_COLOR.RED;
  }
  return SESSION_SLOT_COLOR.AMBER;
}
