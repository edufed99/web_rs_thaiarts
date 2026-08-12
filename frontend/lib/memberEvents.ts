export const MEMBER_ACTIVITY_CHANGED_EVENT = "thai_arts_member_activity_changed";

export function notifyMemberActivityChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MEMBER_ACTIVITY_CHANGED_EVENT));
  }
}
