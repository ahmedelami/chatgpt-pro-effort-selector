import test from "node:test";
import assert from "node:assert/strict";

import {
  PhaseTransitionError,
  classifyLostOperation,
  isPreSendActivePhase,
  transitionPhase
} from "../core/state-core.mjs";

test("models the successful one-shot lifecycle", () => {
  let phase = "idle";

  phase = transitionPhase(phase, "begin");
  assert.equal(phase, "attaching");

  phase = transitionPhase(
    phase,
    "attached"
  );
  assert.equal(phase, "enabling");

  phase = transitionPhase(
    phase,
    "enabled"
  );
  assert.equal(phase, "armed");

  phase = transitionPhase(
    phase,
    "candidate"
  );
  assert.equal(phase, "settling");

  phase = transitionPhase(
    phase,
    "unique"
  );
  assert.equal(phase, "processing");

  phase = transitionPhase(
    phase,
    "continued"
  );
  assert.equal(phase, "sent");

  phase = transitionPhase(
    phase,
    "cleanup"
  );
  assert.equal(phase, "cleaning");

  phase = transitionPhase(
    phase,
    "cleaned"
  );
  assert.equal(phase, "complete");

  phase = transitionPhase(
    phase,
    "verified"
  );
  assert.equal(phase, "verified");
});

test("allows all pre-send active phases to fail closed", () => {
  for (const phase of [
    "attaching",
    "enabling",
    "armed",
    "settling",
    "processing"
  ]) {
    assert.equal(
      transitionPhase(phase, "fail"),
      "failed"
    );
  }
});

test("rejects duplicate and backwards transitions", () => {
  assert.throws(
    () =>
      transitionPhase("armed", "enabled"),
    PhaseTransitionError
  );

  assert.throws(
    () =>
      transitionPhase(
        "processing",
        "candidate"
      ),
    PhaseTransitionError
  );

  assert.throws(
    () =>
      transitionPhase("complete", "cleanup"),
    PhaseTransitionError
  );

  assert.throws(
    () =>
      transitionPhase("failed", "begin"),
    PhaseTransitionError
  );
});

test("identifies only pre-send debugger-active phases", () => {
  for (const phase of [
    "attaching",
    "enabling",
    "armed",
    "settling",
    "processing"
  ]) {
    assert.equal(
      isPreSendActivePhase(phase),
      true
    );
  }

  for (const phase of [
    "idle",
    "sent",
    "cleaning",
    "sent_warning",
    "complete",
    "verified",
    "failed"
  ]) {
    assert.equal(
      isPreSendActivePhase(phase),
      false
    );
  }
});

test("classifies service-worker loss after a known continued request as sent warning", () => {
  assert.deepEqual(
    classifyLostOperation({
      requestContinued: true,
      pausedRequestCount: 0,
      abortSucceeded: false,
      hasSubmittedUserMessageId: true
    }),
    {
      status: "sent_warning",
      canVerify: true,
      error: "worker_state_lost_after_send"
    }
  );
});

test("classifies state loss after replay authorization but before a pause as uncertain", () => {
  assert.deepEqual(
    classifyLostOperation({
      requestContinued: false,
      pausedRequestCount: 0,
      abortSucceeded: true,
      hasSubmittedUserMessageId: false,
      replayAuthorized: true
    }),
    {
      status: "uncertain",
      canVerify: false,
      error: "outcome_uncertain"
    }
  );
});

test("an explicitly cancelled replay remains a definite failure", () => {
  assert.deepEqual(
    classifyLostOperation({
      requestContinued: false,
      pausedRequestCount: 0,
      abortSucceeded: true,
      hasSubmittedUserMessageId: false,
      replayAuthorized: true,
      replayCancelled: true
    }),
    {
      status: "failed",
      canVerify: false,
      error: "worker_state_lost"
    }
  );
});

test("classifies an unabortable retained paused request as uncertain", () => {
  assert.deepEqual(
    classifyLostOperation({
      requestContinued: false,
      pausedRequestCount: 1,
      abortSucceeded: false,
      hasSubmittedUserMessageId: true
    }),
    {
      status: "uncertain",
      canVerify: true,
      error: "outcome_uncertain"
    }
  );
});

test("classifies a pre-send stale arm with no escaped request as failed", () => {
  assert.deepEqual(
    classifyLostOperation({
      requestContinued: false,
      pausedRequestCount: 1,
      abortSucceeded: true,
      hasSubmittedUserMessageId: true
    }),
    {
      status: "failed",
      canVerify: false,
      error: "worker_state_lost"
    }
  );

  assert.deepEqual(
    classifyLostOperation({
      requestContinued: false,
      pausedRequestCount: 0,
      abortSucceeded: true,
      hasSubmittedUserMessageId: false
    }),
    {
      status: "failed",
      canVerify: false,
      error: "worker_state_lost"
    }
  );
});
