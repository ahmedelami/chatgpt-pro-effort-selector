export class PhaseTransitionError extends Error {
  constructor(currentPhase, eventName) {
    super(
      `Invalid one-shot transition: ${currentPhase} + ${eventName}`
    );
    this.name = "PhaseTransitionError";
    this.currentPhase = currentPhase;
    this.eventName = eventName;
  }
}

const TRANSITIONS = Object.freeze({
  idle: Object.freeze({
    begin: "attaching"
  }),
  attaching: Object.freeze({
    attached: "enabling",
    fail: "failed"
  }),
  enabling: Object.freeze({
    enabled: "armed",
    fail: "failed"
  }),
  armed: Object.freeze({
    candidate: "settling",
    fail: "failed"
  }),
  settling: Object.freeze({
    unique: "processing",
    fail: "failed"
  }),
  processing: Object.freeze({
    continued: "sent",
    fail: "failed"
  }),
  sent: Object.freeze({
    cleanup: "cleaning",
    warning: "sent_warning"
  }),
  cleaning: Object.freeze({
    cleaned: "complete",
    warning: "sent_warning"
  }),
  sent_warning: Object.freeze({
    cleaned: "complete",
    verified: "verified"
  }),
  complete: Object.freeze({
    verified: "verified"
  }),
  verified: Object.freeze({}),
  failed: Object.freeze({})
});

export function transitionPhase(currentPhase, eventName) {
  const nextPhase =
    TRANSITIONS[currentPhase]?.[eventName];

  if (!nextPhase) {
    throw new PhaseTransitionError(
      currentPhase,
      eventName
    );
  }

  return nextPhase;
}

export function isPreSendActivePhase(phase) {
  return (
    phase === "attaching" ||
    phase === "enabling" ||
    phase === "armed" ||
    phase === "settling" ||
    phase === "processing"
  );
}

export function classifyLostOperation({
  requestContinued,
  pausedRequestCount,
  abortSucceeded,
  hasSubmittedUserMessageId,
  replayAuthorized = false,
  replayCancelled = false
}) {
  if (requestContinued) {
    return {
      status: "sent_warning",
      canVerify: hasSubmittedUserMessageId,
      error: "worker_state_lost_after_send"
    };
  }

  if (pausedRequestCount > 0 && !abortSucceeded) {
    return {
      status: "uncertain",
      canVerify: hasSubmittedUserMessageId,
      error: "outcome_uncertain"
    };
  }

  if (replayAuthorized && !replayCancelled) {
    return {
      status: "uncertain",
      canVerify: hasSubmittedUserMessageId,
      error: "outcome_uncertain"
    };
  }

  return {
    status: "failed",
    canVerify: false,
    error: "worker_state_lost"
  };
}
