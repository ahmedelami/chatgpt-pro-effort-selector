(() => {
  "use strict";

  const STANDARD = "standard";
  const EXTENDED = "extended";

  const CHATGPT_ORIGIN =
    "https://chatgpt.com";
  const MODE_STORAGE_PREFIX =
    "proEffortMode.chat.";
  const DRAFT_SESSION_STORAGE_KEY =
    "proEffortMode.draft";

  const CONVERSATION_PATH_RE =
    /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

  const hasOwn = (value, propertyName) =>
    Object.prototype.hasOwnProperty.call(
      value,
      propertyName
    );

  function normalizeMode(value) {
    return value === EXTENDED
      ? EXTENDED
      : STANDARD;
  }

  function storageKeyForConversationId(
    conversationId
  ) {
    return `${MODE_STORAGE_PREFIX}${conversationId}`;
  }

  function readDraftModeFromSessionStorage(
    storage
  ) {
    try {
      return normalizeMode(
        storage?.getItem(
          DRAFT_SESSION_STORAGE_KEY
        )
      );
    } catch {
      return STANDARD;
    }
  }

  function persistDraftModeToSessionStorage(
    storage,
    value
  ) {
    const mode = normalizeMode(value);

    try {
      storage?.setItem(
        DRAFT_SESSION_STORAGE_KEY,
        mode
      );
    } catch {
      // The in-memory mode remains usable when session storage is blocked.
    }

    return mode;
  }

  function clearDraftModeFromSessionStorage(
    storage
  ) {
    try {
      storage?.removeItem(
        DRAFT_SESSION_STORAGE_KEY
      );
    } catch {
      // A blocked removal still resolves the active document to Standard.
    }

    return STANDARD;
  }

  function createDraftRoute(pathname = "") {
    return Object.freeze({
      kind: "draft",
      conversationId: null,
      storageKey: null,
      pathname
    });
  }

  function parseChatRoute(rawUrl) {
    let parsedUrl;

    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return createDraftRoute();
    }

    const pathname = parsedUrl.pathname;
    const match =
      parsedUrl.origin === CHATGPT_ORIGIN
        ? pathname.match(
            CONVERSATION_PATH_RE
          )
        : null;

    if (!match) {
      return createDraftRoute(pathname);
    }

    const conversationId = match[1];

    return Object.freeze({
      kind: "conversation",
      conversationId,
      storageKey:
        storageKeyForConversationId(
          conversationId
        ),
      pathname
    });
  }

  function sameChatRoute(left, right) {
    if (!left || !right) {
      return false;
    }

    if (
      left.kind === "conversation" ||
      right.kind === "conversation"
    ) {
      return (
        left.kind === "conversation" &&
        right.kind === "conversation" &&
        typeof left.storageKey ===
          "string" &&
        typeof right.storageKey ===
          "string" &&
        left.storageKey === right.storageKey
      );
    }

    /*
     * All noncanonical, UUID-less paths in one tab share the tab-session
     * draft mode. Entering a draft from a saved chat is handled as a route
     * transition by the content script.
     */
    return (
      left.kind === "draft" &&
      right.kind === "draft"
    );
  }

  function readModeForRoute(
    storedValues,
    route,
    draftMode = STANDARD
  ) {
    if (route?.kind !== "conversation") {
      return normalizeMode(draftMode);
    }

    if (
      typeof route.storageKey !==
        "string" ||
      !storedValues ||
      typeof storedValues !== "object" ||
      !hasOwn(
        storedValues,
        route.storageKey
      )
    ) {
      return STANDARD;
    }

    return normalizeMode(
      storedValues[route.storageKey]
    );
  }

  function storageChangeAffectsRoute(
    changes,
    route
  ) {
    return (
      route?.kind === "conversation" &&
      typeof route.storageKey ===
        "string" &&
      changes !== null &&
      typeof changes === "object" &&
      hasOwn(changes, route.storageKey)
    );
  }

  function isDraftAdoptionTarget({
    fromRoute,
    toRoute,
    draftMode,
    activeDraftSend,
    alreadyAdopted = false,
    targetWasPreexisting = false,
    navigationDisqualified = false
  }) {
    return (
      fromRoute?.kind === "draft" &&
      toRoute?.kind === "conversation" &&
      typeof toRoute.storageKey ===
        "string" &&
      normalizeMode(draftMode) ===
        EXTENDED &&
      activeDraftSend === true &&
      alreadyAdopted !== true &&
      targetWasPreexisting !== true &&
      navigationDisqualified !== true
    );
  }

  function shouldAdoptDraftMode({
    fromRoute,
    toRoute,
    draftMode,
    activeDraftSend,
    sendSucceeded,
    alreadyAdopted = false,
    targetWasPreexisting = false,
    navigationDisqualified = false
  }) {
    return (
      isDraftAdoptionTarget({
        fromRoute,
        toRoute,
        draftMode,
        activeDraftSend,
        alreadyAdopted,
        targetWasPreexisting,
        navigationDisqualified
      }) &&
      sendSucceeded === true
    );
  }

  function decideSubmissionForMode(
    mode,
    modelState
  ) {
    const normalizedMode =
      normalizeMode(mode);

    if (normalizedMode !== EXTENDED) {
      return Object.freeze({
        mode: normalizedMode,
        policy: "pass"
      });
    }

    if (modelState === "pro") {
      return Object.freeze({
        mode: normalizedMode,
        policy: "gate"
      });
    }

    if (modelState === "other") {
      return Object.freeze({
        mode: normalizedMode,
        policy: "pass"
      });
    }

    return Object.freeze({
      mode: normalizedMode,
      policy: "block_unknown"
    });
  }

  globalThis.ProEffortModeCore =
    Object.freeze({
      STANDARD,
      EXTENDED,
      MODE_STORAGE_PREFIX,
      DRAFT_SESSION_STORAGE_KEY,
      normalizeMode,
      storageKeyForConversationId,
      readDraftModeFromSessionStorage,
      persistDraftModeToSessionStorage,
      clearDraftModeFromSessionStorage,
      parseChatRoute,
      sameChatRoute,
      readModeForRoute,
      storageChangeAffectsRoute,
      isDraftAdoptionTarget,
      shouldAdoptDraftMode,
      decideSubmissionForMode
    });
})();
