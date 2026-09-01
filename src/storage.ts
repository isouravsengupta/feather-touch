import { LESSONS } from "./lessons";
import { recommendedLesson, type Session } from "./stats";

const STORAGE_KEY = "feather-touch-v1";

export type SavedState = {
  sessions: Session[];
  lessonId: string;
  eyesUp: boolean;
};

function emptyState(): SavedState {
  return {
    sessions: [],
    lessonId: LESSONS[0].id,
    eyesUp: false,
  };
}

export function loadState(): SavedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const lessonId =
      typeof parsed.lessonId === "string" && LESSONS.some((l) => l.id === parsed.lessonId)
        ? parsed.lessonId
        : recommendedLesson(sessions).id;
    return {
      sessions,
      lessonId,
      eyesUp: Boolean(parsed.eyesUp),
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: SavedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
