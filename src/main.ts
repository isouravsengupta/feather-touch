import "./style.css";
import {
  FINGER_BY_KEY,
  FINGER_MAP,
  KEY_ROWS,
  LESSONS,
  TARGET_ACCURACY,
  TARGET_WPM,
  lessonNumber,
  type Lesson,
} from "./lessons";
import { loadState, saveState } from "./storage";
import {
  accuracyPct,
  buildLine,
  estimateDaysToAverage,
  formatClock,
  hashString,
  mulberry32,
  netWpm,
  recommendedLesson,
  SESSION_SECONDS,
  streakCount,
  todayStamp,
  type Session,
} from "./stats";

type Phase = "idle" | "running" | "done";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing #app");
const app: HTMLDivElement = root;

const saved = loadState();
let sessions: Session[] = saved.sessions;
let lessonId = saved.lessonId;
let eyesUp = saved.eyesUp;
let phase: Phase = "idle";
let secondsLeft = SESSION_SECONDS;
let typed = "";
let lineIndex = 0;
let correct = 0;
let errors = 0;
let startMs: number | null = null;
let finished = false;
let timer: number | null = null;

function persist(): void {
  saveState({ sessions, lessonId, eyesUp });
}

function currentLesson(): Lesson {
  return LESSONS.find((lesson) => lesson.id === lessonId) ?? LESSONS[0];
}

function currentPrompt(): string {
  const lesson = currentLesson();
  return buildLine(
    lesson,
    mulberry32(hashString(`${lesson.id}:${lineIndex}:${todayStamp()}`)),
  );
}

function elapsedSec(): number {
  if (phase === "idle" || startMs === null) return 0;
  return Math.max(1, Math.floor((Date.now() - startMs) / 1000));
}

function startSession(): void {
  if (!eyesUp || phase === "running") return;
  startMs = Date.now();
  finished = false;
  correct = 0;
  errors = 0;
  typed = "";
  secondsLeft = SESSION_SECONDS;
  phase = "running";
  if (timer !== null) window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (startMs === null) return;
    secondsLeft = Math.max(0, SESSION_SECONDS - Math.floor((Date.now() - startMs) / 1000));
    if (secondsLeft <= 0) finishSession();
    else render();
  }, 250);
  render();
  queueMicrotask(() => document.querySelector<HTMLInputElement>("#typed")?.focus());
}

function finishSession(): void {
  if (finished) return;
  finished = true;
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  const duration = startMs
    ? Math.min(SESSION_SECONDS, Math.floor((Date.now() - startMs) / 1000))
    : SESSION_SECONDS;
  phase = "done";
  if (correct >= 20) {
    sessions = [
      ...sessions,
      {
        date: todayStamp(),
        lessonId: currentLesson().id,
        lessonTitle: currentLesson().title,
        durationSec: duration,
        wpm: netWpm(correct, Math.max(duration, 1)),
        accuracy: accuracyPct(correct, errors),
        chars: correct,
        errors,
      },
    ];
    persist();
  }
  render();
}

function resetIdle(): void {
  startMs = null;
  finished = false;
  phase = "idle";
  typed = "";
  secondsLeft = SESSION_SECONDS;
  correct = 0;
  errors = 0;
  lineIndex += 1;
  render();
}

function handleTyped(value: string): void {
  if (phase === "done") return;
  if (phase === "idle") {
    if (!eyesUp) return;
    startSession();
  }
  const prompt = currentPrompt();
  if (value.length < typed.length) {
    typed = value;
    render();
    restoreCaret();
    return;
  }
  const next = value.slice(0, prompt.length);
  const added = next.slice(typed.length);
  for (let i = 0; i < added.length; i++) {
    const idx = typed.length + i;
    if (added[i] === prompt[idx]) correct += 1;
    else errors += 1;
  }
  if (next === prompt) {
    typed = "";
    lineIndex += 1;
    render();
    restoreCaret();
    return;
  }
  typed = next;
  render();
  restoreCaret();
}

function restoreCaret(): void {
  const input = document.querySelector<HTMLInputElement>("#typed");
  if (!input) return;
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
}

function promptHtml(prompt: string): string {
  return prompt
    .split("")
    .map((ch, i) => {
      const typedCh = typed[i];
      let cls = "wait";
      if (i === typed.length) cls = "now";
      else if (typedCh !== undefined) cls = typedCh === ch ? "done" : "miss";
      const shown = ch === " " ? "&nbsp;" : escapeHtml(ch);
      return `<span class="${cls}">${shown}</span>`;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function keyboardHtml(nextChar: string, lesson: Lesson): string {
  const lessonKeys = new Set(lesson.keys.toLowerCase().split(""));
  return KEY_ROWS.map((row, ri) => {
    const keys = row
      .map((key) => {
        const active =
          nextChar.toLowerCase() === key.label || (key.label === " " && nextChar === " ");
        const classes = [
          "key",
          key.home ? "home" : "",
          lessonKeys.has(key.label) || key.label === " " ? "lesson" : "",
          active ? "active" : "",
          key.label === " " ? "space" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const label =
          key.label === " "
            ? "space"
            : key.label === "f" || key.label === "j"
              ? `${key.label} ·`
              : escapeHtml(key.label);
        return `<div class="${classes}">${label}</div>`;
      })
      .join("");
    return `<div class="row${ri === 4 ? " space" : ""}">${keys}</div>`;
  }).join("");
}

function chartSvg(data: Session[]): string {
  if (data.length < 2) return "";
  const w = 880;
  const h = 180;
  const pad = 18;
  const xs = data.map((_, i) => pad + (i * (w - pad * 2)) / (data.length - 1));
  const y = (value: number) => pad + ((100 - value) * (h - pad * 2)) / 100;
  const wpm = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y(data[i].wpm).toFixed(1)}`).join(" ");
  const acc = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y(data[i].accuracy).toFixed(1)}`).join(" ");
  const target = y(TARGET_WPM);
  return `
    <svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Net WPM and accuracy across saved sessions">
      <line x1="${pad}" x2="${w - pad}" y1="${target}" y2="${target}" stroke="#3d342b" stroke-dasharray="4 4" />
      <path d="${acc}" fill="none" stroke="#7eae8a" stroke-width="2" />
      <path d="${wpm}" fill="none" stroke="#c4a574" stroke-width="2.5" />
    </svg>
    <p class="chart-caption">Gold line is net WPM. Green line is accuracy %. Dashed line is world-average 40 WPM. Source: sessions saved in this browser · last ${data.length} runs.</p>
  `;
}

function render(): void {
  const lesson = currentLesson();
  const prompt = currentPrompt();
  const liveWpm = netWpm(correct, elapsedSec());
  const liveAcc = accuracyPct(correct, errors);
  const nextChar = prompt[typed.length] ?? "";
  const nextFinger =
    FINGER_BY_KEY[nextChar.toLowerCase()] ?? (nextChar === " " ? "Thumbs" : "Look at the highlight");
  const practicedToday = sessions.some((s) => s.date === todayStamp());
  const streak = streakCount(sessions);
  const estimate = estimateDaysToAverage(sessions);
  const recommended = recommendedLesson(sessions);
  const usedPct = ((SESSION_SECONDS - secondsLeft) / SESSION_SECONDS) * 100;
  const chartSessions = sessions.slice(-14);
  const recent = [...sessions].slice(-8).reverse();

  app.innerHTML = `
    <header class="masthead">
      <div class="mark">
        <h1>Feather Touch</h1>
        <p>A typing trainer · 10 minutes a day</p>
      </div>
      <p class="rule">Eyes up · home row · accuracy first</p>
    </header>

    <p class="lede">
      World-average adult speed is about 40 words per minute at ~95% accuracy,
      without looking at the keyboard. At 10 focused minutes a day that is
      usually 4–8 weeks. Speed drops at first while your fingers learn home row.
      That is the correct path.
    </p>

    <section class="stats">
      <div class="stat"><b>40 WPM</b><span>World-average target</span></div>
      <div class="stat"><b>${escapeHtml(estimate.days)} days</b><span>${escapeHtml(estimate.label)}</span></div>
      <div class="stat"><b>${escapeHtml(estimate.hours)} h</b><span>Practice time to average</span></div>
      <div class="stat"><b>${streak > 0 ? streak : practicedToday ? 1 : 0}</b><span>Day streak</span></div>
    </section>

    <div class="notice">
      <strong>The only rule that matters</strong>
      Eyes on this screen. Index fingers rest on F and J. If you look down,
      stop, return home, and restart the line. Accuracy above 95% beats a
      higher WPM.
    </div>

    <h2>Today’s 10-minute drill</h2>
    <section class="drill">
      <div class="drill-head">
        <span>Lesson ${lessonNumber(lesson.id)} of ${LESSONS.length}</span>
        <span>${escapeHtml(lesson.title)}</span>
      </div>
      <p class="focus">${escapeHtml(lesson.focus)}</p>
      <div class="controls">
        <select id="lesson" ${phase === "running" ? "disabled" : ""}>
          ${LESSONS.map(
            (item, i) =>
              `<option value="${item.id}" ${item.id === lesson.id ? "selected" : ""}>Week ${item.week} · ${i + 1}. ${escapeHtml(item.title)}</option>`,
          ).join("")}
        </select>
        <button class="ghost" id="recommend" ${phase === "running" ? "disabled" : ""}>Use recommended</button>
      </div>
      <label class="pledge">
        <input id="eyes" type="checkbox" ${eyesUp ? "checked" : ""} ${phase === "running" ? "disabled" : ""} />
        Hands on home row. I will not look at the keyboard.
      </label>
      ${
        phase === "idle"
          ? ""
          : `<div class="meter" aria-hidden="true"><span style="width:${usedPct}%"></span></div>`
      }
      <div class="live">
        <div class="stat"><b>${formatClock(secondsLeft)}</b><span>Time left</span></div>
        <div class="stat"><b>${liveWpm}</b><span>Net WPM</span></div>
        <div class="stat"><b>${liveAcc}%</b><span>Accuracy</span></div>
      </div>
      <div class="prompt" aria-live="polite">${promptHtml(prompt)}</div>
      <input id="typed" type="text" autocomplete="off" spellcheck="false"
        placeholder="${eyesUp ? "Click here, then type the line above. Do not look down." : "Check the home-row box first."}"
        value="${escapeHtml(typed)}"
        ${!eyesUp || phase === "done" ? "disabled" : ""} />
      <p class="next">Next key: ${nextChar === " " ? "space" : escapeHtml(nextChar) || "line complete"} · ${escapeHtml(nextFinger)}</p>
      <div class="actions">
        ${phase === "idle" ? `<button id="start" ${eyesUp ? "" : "disabled"}>Start 10 minutes</button>` : ""}
        ${phase === "running" ? `<button class="secondary" id="end">End session</button>` : ""}
        ${phase === "done" ? `<button id="again">Practice again</button>` : ""}
      </div>
      ${
        phase === "done"
          ? `<div class="notice ${liveAcc >= TARGET_ACCURACY ? "good" : "warn"}"><strong>Session saved</strong>${liveWpm} WPM at ${liveAcc}% accuracy. Tomorrow stay on this lesson if accuracy is under 95%.</div>`
          : ""
      }
      ${
        practicedToday && phase === "idle"
          ? `<div class="notice good"><strong>Today is already logged</strong>A session is saved for ${todayStamp()}. Another 10 minutes is optional; consistency beats extra volume.</div>`
          : ""
      }
    </section>

    <h2>Keyboard — next key is highlighted</h2>
    <p class="muted">Home-row keys are filled. F and J show a bump mark. Only the next character uses gold.</p>
    <div class="keyboard">${keyboardHtml(nextChar, lesson)}</div>

    <details>
      <summary>Finger map (home position)</summary>
      <table>
        <thead><tr><th>Finger</th><th>Home key</th><th>Also types</th></tr></thead>
        <tbody>
          ${FINGER_MAP.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </details>

    ${
      chartSessions.length >= 2
        ? `<h2>Net WPM across saved sessions</h2>${chartSvg(chartSessions)}`
        : ""
    }

    ${
      recent.length > 0
        ? `<h2>Recent sessions</h2>
          <table>
            <thead><tr><th>Date</th><th>Lesson</th><th class="num">WPM</th><th class="num">Accuracy</th><th class="num">Time</th></tr></thead>
            <tbody>
              ${recent
                .map(
                  (s) =>
                    `<tr><td>${escapeHtml(s.date)}</td><td>${escapeHtml(s.lessonTitle)}</td><td class="num">${s.wpm}</td><td class="num">${s.accuracy}%</td><td class="num">${formatClock(s.durationSec)}</td></tr>`,
                )
                .join("")}
            </tbody>
          </table>`
        : ""
    }

    <h2>Plan to world-average</h2>
    <p class="muted">These ranges assume a hunt-and-peck start, 10 minutes every day, and almost no looking.</p>
    <table>
      <thead><tr><th>Week</th><th>What you can do</th><th>Typical WPM</th><th>Days at 10 min</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>Home row without looking</td><td>8–18</td><td>1–7</td></tr>
        <tr><td>2</td><td>All letters, still watching the screen</td><td>15–28</td><td>8–14</td></tr>
        <tr><td>3</td><td>Punctuation and numbers for code</td><td>25–38</td><td>15–21</td></tr>
        <tr><td>4–8</td><td>World-average, eyes off the keys</td><td>${TARGET_WPM}+</td><td>28–56</td></tr>
        <tr><td>8–12</td><td>Comfortable coding speed</td><td>50–60</td><td>56–84</td></tr>
      </tbody>
    </table>
    <p class="footnote">Benchmarks: adult average ~40 WPM. 10-minute daily blocks are the standard recommendation in touch-typing curricula.</p>
  `;

  document.querySelector<HTMLSelectElement>("#lesson")?.addEventListener("change", (event) => {
    if (phase === "running") return;
    lessonId = (event.target as HTMLSelectElement).value;
    typed = "";
    lineIndex = 0;
    persist();
    render();
  });
  document.querySelector("#recommend")?.addEventListener("click", () => {
    if (phase === "running") return;
    lessonId = recommended.id;
    typed = "";
    lineIndex = 0;
    persist();
    render();
  });
  document.querySelector<HTMLInputElement>("#eyes")?.addEventListener("change", (event) => {
    eyesUp = (event.target as HTMLInputElement).checked;
    persist();
    render();
  });
  document.querySelector<HTMLInputElement>("#typed")?.addEventListener("input", (event) => {
    handleTyped((event.target as HTMLInputElement).value);
  });
  document.querySelector("#start")?.addEventListener("click", startSession);
  document.querySelector("#end")?.addEventListener("click", finishSession);
  document.querySelector("#again")?.addEventListener("click", resetIdle);
}

render();
