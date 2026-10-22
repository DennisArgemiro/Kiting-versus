/**
 * Local progression. Everything lives in localStorage so the trainer works
 * fully offline and the browser keeps the history between sessions.
 */
const KEY = "skillgap-web.v1";

const EMPTY = {
  version: 1,
  champion: "Ezreal",
  drills: {},
  history: {},
  totals: { sessions: 0, bestScore: 0, totalTime: 0 },
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(EMPTY), ...parsed };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage disabled - progression simply will not persist */
  }
}

export const store = {
  state: read(),

  champion() {
    return this.state.champion || "Ezreal";
  },

  setChampion(alias) {
    this.state.champion = alias;
    write(this.state);
  },

  drill(drillId) {
    if (!this.state.drills[drillId]) {
      this.state.drills[drillId] = { levels: {}, unlocked: 1 };
    }
    return this.state.drills[drillId];
  },

  /** Highest level index the player may attempt. */
  unlockedLevel(drillId) {
    return this.drill(drillId).unlocked || 1;
  },

  levelRecord(drillId, level) {
    return this.drill(drillId).levels[level] || null;
  },

  isLevelDone(drillId, level) {
    return Boolean(this.levelRecord(drillId, level));
  },

  /**
   * Store a run. Returns { isBest, unlockedNext } so the UI can celebrate.
   */
  recordResult(drillId, level, score, stats, unlockScore) {
    const entry = this.drill(drillId);
    const record = entry.levels[level] || { best: 0, attempts: 0 };
    const isBest = score > record.best;
    record.attempts += 1;
    record.lastScore = score;
    record.lastStats = stats;
    if (isBest) record.best = score;
    entry.levels[level] = record;

    const history = this.state.history[drillId] || [];
    history.push({ ts: Date.now(), level, score });
    if (history.length > 60) history.shift();
    this.state.history[drillId] = history;

    this.state.totals.sessions += 1;
    this.state.totals.bestScore = Math.max(this.state.totals.bestScore, score);
    this.state.totals.totalTime += stats.duration || 0;

    let unlockedNext = false;
    if (score >= unlockScore && (entry.unlocked || 1) === level) {
      entry.unlocked = level + 1;
      unlockedNext = true;
    }
    write(this.state);
    return { isBest, unlockedNext };
  },

  history(drillId) {
    return this.state.history[drillId] || [];
  },

  totals() {
    return this.state.totals;
  },

  /** Aggregate numbers for the statistics screen. */
  summary() {
    const rows = [];
    let best = 0;
    let attempts = 0;
    for (const [drillId, data] of Object.entries(this.state.drills)) {
      for (const [level, record] of Object.entries(data.levels || {})) {
        rows.push({ drillId, level: Number(level), ...record });
        best = Math.max(best, record.best || 0);
        attempts += record.attempts || 0;
      }
    }
    rows.sort((a, b) => b.best - a.best);
    return { rows, best, attempts, sessions: this.state.totals.sessions };
  },

  reset() {
    this.state = structuredClone(EMPTY);
    write(this.state);
  },
};
