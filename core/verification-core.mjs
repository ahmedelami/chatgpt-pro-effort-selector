export const VERIFIED_MODEL_SLUG = "gpt-5-6-pro";
export const VERIFIED_THINKING_EFFORT = "extended";

const hasOwn = (value, propertyName) =>
  Object.prototype.hasOwnProperty.call(value, propertyName);

export class VerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new VerificationError(code, message);
}

function requireRecord(value, code, message) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(code, message);
  }
}

function normalizeMarker(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

function getMessage(node) {
  return node?.message &&
    typeof node.message === "object" &&
    !Array.isArray(node.message)
    ? node.message
    : {};
}

function getRole(node) {
  const role = getMessage(node)?.author?.role;
  return typeof role === "string" ? role : "";
}

function getMessageId(nodeId, node) {
  const messageId = getMessage(node).id;

  if (typeof messageId === "string" && messageId.length > 0) {
    return messageId;
  }

  return typeof nodeId === "string" ? nodeId : "";
}

export function isIgnoredConversationNode(node) {
  const message = getMessage(node);
  const metadata =
    message.metadata &&
    typeof message.metadata === "object" &&
    !Array.isArray(message.metadata)
      ? message.metadata
      : {};
  const content =
    message.content &&
    typeof message.content === "object" &&
    !Array.isArray(message.content)
      ? message.content
      : {};

  const markers = [
    node?.type,
    message.type,
    content.content_type,
    metadata.type,
    metadata.message_type,
    metadata.content_type
  ].map(normalizeMarker);

  return (
    markers.includes("reasoning_recap") ||
    markers.includes("model_editable_context")
  );
}

function buildActiveBranch(snapshot) {
  requireRecord(
    snapshot,
    "invalid_snapshot",
    "The durable verification snapshot was invalid."
  );

  requireRecord(
    snapshot.mapping,
    "invalid_mapping",
    "The durable verification snapshot had no valid mapping."
  );

  if (
    typeof snapshot.current_node !== "string" ||
    snapshot.current_node.length === 0
  ) {
    fail(
      "missing_current_node",
      "The durable verification snapshot had no current node."
    );
  }

  const reverseBranch = [];
  const visited = new Set();
  let cursor = snapshot.current_node;

  while (
    typeof cursor === "string" &&
    cursor.length > 0 &&
    hasOwn(snapshot.mapping, cursor)
  ) {
    if (visited.has(cursor)) {
      fail(
        "mapping_cycle",
        "The durable verification mapping contained a cycle."
      );
    }

    visited.add(cursor);

    const node = snapshot.mapping[cursor];

    requireRecord(
      node,
      "invalid_node",
      "The durable verification mapping contained an invalid node."
    );

    reverseBranch.push({
      nodeId: cursor,
      node
    });

    cursor =
      typeof node.parent === "string"
        ? node.parent
        : "";
  }

  if (reverseBranch.length === 0) {
    fail(
      "empty_active_branch",
      "The durable verification active branch was empty."
    );
  }

  return reverseBranch.reverse();
}

function isProofBearingAssistant(node) {
  if (getRole(node) !== "assistant") {
    return false;
  }

  if (isIgnoredConversationNode(node)) {
    return false;
  }

  const message = getMessage(node);
  const metadata =
    message.metadata &&
    typeof message.metadata === "object" &&
    !Array.isArray(message.metadata)
      ? message.metadata
      : {};

  return (
    hasOwn(metadata, "model_slug") ||
    hasOwn(metadata, "thinking_effort") ||
    hasOwn(message, "status") ||
    hasOwn(message, "end_turn")
  );
}

export function verifyRedactedConversationSnapshot(
  snapshot,
  expectedUserMessageId
) {
  if (
    typeof expectedUserMessageId !== "string" ||
    expectedUserMessageId.trim().length === 0
  ) {
    fail(
      "invalid_expected_user_message_id",
      "The retained submitted user message id was invalid."
    );
  }

  const branch = buildActiveBranch(snapshot);
  let targetUserIndex = -1;

  /*
   * Search backward so the nearest matching active-branch user occurrence
   * is selected if malformed data ever duplicates an id.
   */
  for (
    let index = branch.length - 1;
    index >= 0;
    index -= 1
  ) {
    const { nodeId, node } = branch[index];

    if (isIgnoredConversationNode(node)) {
      continue;
    }

    if (
      getRole(node) === "user" &&
      getMessageId(nodeId, node) === expectedUserMessageId
    ) {
      targetUserIndex = index;
      break;
    }
  }

  if (targetUserIndex === -1) {
    return {
      ok: false,
      code: "user_not_on_active_branch",
      message:
        "The submitted user message was not found on the active saved branch."
    };
  }

  const proofCandidates = [];

  for (
    let index = targetUserIndex + 1;
    index < branch.length;
    index += 1
  ) {
    const { node } = branch[index];

    if (isIgnoredConversationNode(node)) {
      continue;
    }

    /*
     * A later user node starts another turn. This guarantees the retained
     * user is the nearest preceding active-branch user for any candidate.
     */
    if (getRole(node) === "user") {
      break;
    }

    if (isProofBearingAssistant(node)) {
      proofCandidates.push(node);
    }
  }

  if (proofCandidates.length === 0) {
    return {
      ok: false,
      code: "proof_assistant_not_found",
      message:
        "No proof-bearing assistant response is saved for that user message yet."
    };
  }

  if (proofCandidates.length !== 1) {
    return {
      ok: false,
      code: "ambiguous_proof_assistant",
      message:
        "The saved turn contains more than one proof-bearing assistant response."
    };
  }

  const assistantMessage = getMessage(proofCandidates[0]);
  const metadata =
    assistantMessage.metadata &&
    typeof assistantMessage.metadata === "object" &&
    !Array.isArray(assistantMessage.metadata)
      ? assistantMessage.metadata
      : {};

  if (metadata.model_slug !== VERIFIED_MODEL_SLUG) {
    return {
      ok: false,
      code: "saved_model_mismatch",
      message:
        "The saved assistant response does not report model_slug gpt-5-6-pro."
    };
  }

  if (
    metadata.thinking_effort !== VERIFIED_THINKING_EFFORT
  ) {
    return {
      ok: false,
      code: "saved_effort_mismatch",
      message:
        "The saved assistant response does not report thinking_effort extended."
    };
  }

  if (assistantMessage.status !== "finished_successfully") {
    return {
      ok: false,
      code: "not_finished_successfully",
      message:
        "The saved assistant response is not marked finished_successfully."
    };
  }

  if (assistantMessage.end_turn !== true) {
    return {
      ok: false,
      code: "end_turn_missing",
      message:
        "The saved assistant response is not marked end_turn true."
    };
  }

  return {
    ok: true,
    code: "verified_extended",
    message: "Verified Extended"
  };
}
