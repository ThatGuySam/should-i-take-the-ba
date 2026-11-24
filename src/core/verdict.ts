export type Answer = "yes" | "no";

export type Reading = {
  at: string;
  durationSec: number;
  staticDurationSec: number;
  distanceMeters: number;
};

export type VerdictConfig = {
  enterRatio: number;
  exitRatio: number;
  enterDwellMin: number;
  exitDwellMin: number;
  enterReadings: number;
  exitReadings: number;
  enterMinDelaySec: number;
  exitMaxDelaySec: number;
  maxGapMin: number;
};

export type Pending = { to: Answer; since: string; count: number; lastAt: string };

export type VerdictState = {
  answer: Answer;
  answerSince: string;
  pending: Pending | null;
};

export type Transition = { from: Answer; to: Answer; at: string; delayRatio: number };

export const delayRatio = (r: Reading): number =>
  r.staticDurationSec > 0 ? (r.durationSec - r.staticDurationSec) / r.staticDurationSec : 0;

const minutesBetween = (a: string, b: string): number =>
  (Date.parse(b) - Date.parse(a)) / 60_000;

export const initialState = (at: string): VerdictState => ({
  answer: "yes",
  answerSince: at,
  pending: null,
});

export function step(
  state: VerdictState,
  reading: Reading,
  config: VerdictConfig,
): { state: VerdictState; transition: Transition | null } {
  const ratio = delayRatio(reading);
  const delaySec = reading.durationSec - reading.staticDurationSec;
  const congested = ratio >= config.enterRatio && delaySec >= config.enterMinDelaySec;
  const clear = ratio <= config.exitRatio || delaySec <= config.exitMaxDelaySec;
  const target: Answer | null =
    state.answer === "yes" ? (congested ? "no" : null) : clear ? "yes" : null;

  if (target === null) {
    return { state: { ...state, pending: null }, transition: null };
  }

  const prior = state.pending;
  const continues =
    prior !== null &&
    prior.to === target &&
    minutesBetween(prior.lastAt, reading.at) <= config.maxGapMin;

  const pending: Pending = continues
    ? { ...prior, count: prior.count + 1, lastAt: reading.at }
    : { to: target, since: reading.at, count: 1, lastAt: reading.at };

  const dwell = target === "no" ? config.enterDwellMin : config.exitDwellMin;
  const needed = target === "no" ? config.enterReadings : config.exitReadings;
  const held = minutesBetween(pending.since, reading.at) >= dwell;

  if (held && pending.count >= needed) {
    return {
      state: { answer: target, answerSince: reading.at, pending: null },
      transition: { from: state.answer, to: target, at: reading.at, delayRatio: ratio },
    };
  }

  return { state: { ...state, pending }, transition: null };
}
