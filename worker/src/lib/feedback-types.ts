// §8.4a.25 — shared feedback type union. Lifted into its own file so libs
// don't depend on each other circularly.
export const FEEDBACK_TYPES = ["bug", "confusion", "feature", "question"] as const;
export type FeedbackType = typeof FEEDBACK_TYPES[number];
