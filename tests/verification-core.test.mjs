import test from "node:test";
import assert from "node:assert/strict";

import {
  VerificationError,
  verifyRedactedConversationSnapshot
} from "../core/verification-core.mjs";

function userNode(id, parent = null) {
  return {
    id,
    parent,
    message: {
      id,
      author: {
        role: "user"
      },
      content: {
        content_type: "text"
      },
      metadata: {},
      status: "finished_successfully",
      end_turn: false
    }
  };
}

function assistantNode(
  id,
  parent,
  overrides = {}
) {
  return {
    id,
    parent,
    message: {
      id,
      author: {
        role: "assistant"
      },
      content: {
        content_type: "text"
      },
      metadata: {
        model_slug: "gpt-5-6-pro",
        thinking_effort: "extended"
      },
      status: "finished_successfully",
      end_turn: true,
      ...overrides
    }
  };
}

test("verifies exactly one proof-bearing assistant for the retained active-branch user", () => {
  const snapshot = {
    current_node: "assistant-final",
    mapping: {
      "user-fresh": userNode("user-fresh"),
      "reasoning-recap": {
        id: "reasoning-recap",
        parent: "user-fresh",
        message: {
          id: "reasoning-recap",
          author: {
            role: "assistant"
          },
          content: {
            content_type: "reasoning_recap"
          },
          metadata: {
            model_slug: "gpt-5-6-pro",
            thinking_effort: "extended"
          },
          status: "finished_successfully",
          end_turn: false
        }
      },
      "editable-context": {
        id: "editable-context",
        parent: "reasoning-recap",
        message: {
          id: "editable-context",
          author: {
            role: "system"
          },
          content: {
            content_type:
              "model_editable_context"
          },
          metadata: {},
          status: "finished_successfully",
          end_turn: false
        }
      },
      "assistant-final": assistantNode(
        "assistant-final",
        "editable-context"
      )
    }
  };

  assert.deepEqual(
    verifyRedactedConversationSnapshot(
      snapshot,
      "user-fresh"
    ),
    {
      ok: true,
      code: "verified_extended",
      message: "Verified Extended"
    }
  );
});

test("rejects a saved assistant with the wrong model", () => {
  const snapshot = {
    current_node: "assistant",
    mapping: {
      user: userNode("user"),
      assistant: assistantNode(
        "assistant",
        "user",
        {
          metadata: {
            model_slug: "gpt-5-6-sol",
            thinking_effort: "extended"
          }
        }
      )
    }
  };

  const result =
    verifyRedactedConversationSnapshot(
      snapshot,
      "user"
    );

  assert.equal(result.ok, false);
  assert.equal(
    result.code,
    "saved_model_mismatch"
  );
});

test("rejects a saved assistant with non-Extended effort", () => {
  const snapshot = {
    current_node: "assistant",
    mapping: {
      user: userNode("user"),
      assistant: assistantNode(
        "assistant",
        "user",
        {
          metadata: {
            model_slug: "gpt-5-6-pro",
            thinking_effort: "standard"
          }
        }
      )
    }
  };

  const result =
    verifyRedactedConversationSnapshot(
      snapshot,
      "user"
    );

  assert.equal(result.ok, false);
  assert.equal(
    result.code,
    "saved_effort_mismatch"
  );
});

test("requires finished_successfully and end_turn true", () => {
  const unfinished = {
    current_node: "assistant",
    mapping: {
      user: userNode("user"),
      assistant: assistantNode(
        "assistant",
        "user",
        {
          status: "in_progress"
        }
      )
    }
  };

  assert.equal(
    verifyRedactedConversationSnapshot(
      unfinished,
      "user"
    ).code,
    "not_finished_successfully"
  );

  const noEndTurn = {
    current_node: "assistant",
    mapping: {
      user: userNode("user"),
      assistant: assistantNode(
        "assistant",
        "user",
        {
          end_turn: false
        }
      )
    }
  };

  assert.equal(
    verifyRedactedConversationSnapshot(
      noEndTurn,
      "user"
    ).code,
    "end_turn_missing"
  );
});

test("rejects ambiguous proof-bearing assistant responses", () => {
  const snapshot = {
    current_node: "assistant-two",
    mapping: {
      user: userNode("user"),
      "assistant-one": assistantNode(
        "assistant-one",
        "user"
      ),
      "assistant-two": assistantNode(
        "assistant-two",
        "assistant-one"
      )
    }
  };

  const result =
    verifyRedactedConversationSnapshot(
      snapshot,
      "user"
    );

  assert.equal(result.ok, false);
  assert.equal(
    result.code,
    "ambiguous_proof_assistant"
  );
});

test("stops correlation at the next active-branch user node", () => {
  const snapshot = {
    current_node: "assistant-two",
    mapping: {
      "user-one": userNode("user-one"),
      "assistant-one": assistantNode(
        "assistant-one",
        "user-one"
      ),
      "user-two": userNode(
        "user-two",
        "assistant-one"
      ),
      "assistant-two": assistantNode(
        "assistant-two",
        "user-two"
      )
    }
  };

  assert.deepEqual(
    verifyRedactedConversationSnapshot(
      snapshot,
      "user-one"
    ),
    {
      ok: true,
      code: "verified_extended",
      message: "Verified Extended"
    }
  );
});

test("fails when the retained user id is not on the active branch", () => {
  const snapshot = {
    current_node: "assistant",
    mapping: {
      user: userNode("user"),
      assistant: assistantNode(
        "assistant",
        "user"
      ),
      "unrelated-user": userNode(
        "unrelated-user"
      )
    }
  };

  const result =
    verifyRedactedConversationSnapshot(
      snapshot,
      "unrelated-user"
    );

  assert.equal(result.ok, false);
  assert.equal(
    result.code,
    "user_not_on_active_branch"
  );
});

test("rejects cyclic durable mappings", () => {
  const snapshot = {
    current_node: "assistant",
    mapping: {
      user: {
        ...userNode("user"),
        parent: "assistant"
      },
      assistant: assistantNode(
        "assistant",
        "user"
      )
    }
  };

  assert.throws(
    () =>
      verifyRedactedConversationSnapshot(
        snapshot,
        "missing-user"
      ),
    (error) =>
      error instanceof VerificationError &&
      error.code === "mapping_cycle"
  );
});
