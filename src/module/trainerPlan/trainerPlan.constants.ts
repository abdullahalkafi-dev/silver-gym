/** Topics a member can pick when asking a trainer. Anything else is a custom title. */
export const PLAN_TOPICS = [
  "Weight loss",
  "Weight gain",
  "Muscle building",
  "Diet plan",
  "Workout plan",
  "Stay fit",
] as const;

export const PLAN_REQUEST_STATUSES = ["pending", "answered", "declined", "cancelled"] as const;
export type TPlanRequestStatus = (typeof PLAN_REQUEST_STATUSES)[number];

export const PLAN_LIMITS = {
  customTopic: 60,
  note: 2000,
  title: 120,
  /** Cleaned HTML of a plan or template. Roughly 15-20 printed pages of text. */
  content: 60_000,
  declineReason: 300,
  templatesPerTrainer: 100,
  memberHistory: 50,
} as const;

/** Filter value meaning "any custom (not preset) topic". */
export const CUSTOM_TOPIC_FILTER = "__custom";

/** Given to members whose trainer was deleted while the request was waiting. */
export const TRAINER_REMOVED_REASON = "This trainer is no longer available. Please ask another trainer.";
