import {
  LESSONS,
  SESSION_SECONDS,
  TARGET_ACCURACY,
  TARGET_WPM,
  type Lesson,
} from "./lessons";

export type Session = {
  date: string;
  lessonId: string;
  lessonTitle: string;
  durationSec: number;
  wpm: number;
  accuracy: number;
  chars: number;
  errors: number;
};

export function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildLine(lesson: Lesson, rng: () => number): string {
  const count = 4 + Math.floor(rng() * 4);
  const picked: string[] = [];
  for (let i = 0; i < count; i++) {
    picked.push(lesson.words[Math.floor(rng() * lesson.words.length)]);
  }
  return picked.join(" ");
}

export function formatClock(seconds: number): string {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function netWpm(correctChars: number, elapsedSec: number): number {
  if (elapsedSec < 3) return 0;
  return Math.round((correctChars / 5) * (60 / elapsedSec) * 10) / 10;
}

export function accuracyPct(correct: number, errors: number): number {
  const total = correct + errors;
  if (total === 0) return 100;
  return Math.round((correct / total) * 1000) / 10;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function qualifyingSessions(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.durationSec >= 480 || s.chars >= 180);
}

export function recommendedLesson(sessions: Session[]): Lesson {
  const done = qualifyingSessions(sessions).length;
  return LESSONS[Math.min(done, LESSONS.length - 1)];
}

export function estimateDaysToAverage(sessions: Session[]): {
  label: string;
  days: string;
  hours: string;
} {
  const qualified = qualifyingSessions(sessions);
  if (qualified.length < 5) {
    return {
      label: "Typical beginner at 10 min/day",
      days: "28–56",
      hours: "5–9",
    };
  }
  const recent = qualified.slice(-5);
  const avg = mean(recent.map((s) => s.wpm));
  if (avg >= TARGET_WPM && mean(recent.map((s) => s.accuracy)) >= TARGET_ACCURACY) {
    return {
      label: "You are at world-average speed",
      days: "0",
      hours: "keep 10 min",
    };
  }
  const gain =
    (recent[recent.length - 1].wpm - recent[0].wpm) / Math.max(1, recent.length - 1);
  const daily = Math.max(0.35, gain);
  const days = Math.max(7, Math.ceil((TARGET_WPM - avg) / daily));
  return {
    label: "From your last 5 qualifying sessions",
    days: String(days),
    hours: String(Math.round((days * 10) / 60)),
  };
}

export function streakCount(sessions: Session[]): number {
  const days = Array.from(new Set(sessions.map((s) => s.date))).sort();
  if (days.length === 0) return 0;
  const today = todayStamp();
  let cursor = today;
  if (days[days.length - 1] !== today) {
    const y = new Date(`${today}T12:00:00`);
    y.setDate(y.getDate() - 1);
    cursor = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    if (days[days.length - 1] !== cursor) return 0;
  }
  let streak = 0;
  const set = new Set(days);
  while (set.has(cursor)) {
    streak += 1;
    const d = new Date(`${cursor}T12:00:00`);
    d.setDate(d.getDate() - 1);
    cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return streak;
}

export { SESSION_SECONDS };
