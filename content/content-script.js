(() => {
  "use strict";

  const MESSAGE_SOURCE =
    "chatgpt-pro-effort-selector";

  const LEGACY_STORAGE_KEY =
    "effortPreference";

  const {
    STANDARD,
    EXTENDED,
    normalizeMode,
    parseChatRoute,
    sameChatRoute,
    readModeForRoute,
    storageChangeAffectsRoute,
    isDraftAdoptionTarget,
    shouldAdoptDraftMode,
    decideSubmissionForMode
  } = globalThis.ProEffortModeCore;

  const ROOT_ATTRIBUTE =
    "data-pro-effort-selector-root";
  const TOAST_ATTRIBUTE =
    "data-pro-effort-selector-toast";
  const POPOVER_ID =
    "pro-effort-selector-popover";

  const EDITABLE_SELECTOR = [
    "textarea",
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[role="textbox"][contenteditable]'
  ].join(",");

  const BUTTON_SELECTOR = [
    "button",
    '[role="button"]'
  ].join(",");

  const MODEL_CONTROL_SELECTOR = [
    "button",
    '[role="button"]',
    '[aria-haspopup="menu"]',
    '[aria-haspopup="listbox"]'
  ].join(",");

  let preference = STANDARD;
  let modelState = "unknown";
  let modelControl = null;

  let activeRoute =
    parseChatRoute(window.location.href);
  let routeLoaded = false;
  let routeEpoch = 0;
  let routeLoadSerial = 0;
  let routeLoadPromise = null;
  let routeLoadTarget = null;
  let draftPreference = STANDARD;
  let draftAdoption = null;
  let navigationInvalidatedOperation =
    false;
  const retiredGenerationIds =
    new Set();

  let root = null;
  let trigger = null;
  let politeLiveRegion = null;
  let alertLiveRegion = null;
  let popover = null;
  let rootMountParent = null;
  let rootMountReference = null;
  let popoverResizeObserver = null;
  let openingFocusEpoch = 0;
  let openingFocusTimers = [];
  let returnFocusEpoch = 0;
  let returnFocusTimer = null;
  let returnFocusCleanup = null;
  let popoverRenderSignature = null;
  let announcementTimer = null;
  let announcementClearTimer = null;
  let lastAnnouncementSignature = null;
  let observer = null;

  let scanScheduled = false;
  let submissionBusy = false;
  let replayDepth = 0;
  let currentGenerationId = null;
  let toastTimer = null;

  let viewState = {
    kind: "standard",
    label: "Standard",
    message: "ChatGPT requests are left untouched.",
    canVerify: false,
    submittedUserMessageId: null
  };

  function runtimeSend(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          source: MESSAGE_SOURCE,
          ...message
        },
        (response) => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(
              new Error("runtime_message_failed")
            );
            return;
          }

          resolve(response);
        }
      );
    });
  }

  function storageGetMode(storageKey) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(
        [storageKey],
        (values) => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(
              new Error("storage_read_failed")
            );
            return;
          }

          resolve(
            readModeForRoute(
              values,
              {
                kind: "conversation",
                storageKey
              }
            )
          );
        }
      );
    });
  }

  function storageSetMode(
    storageKey,
    value
  ) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(
        {
          [storageKey]:
            normalizeMode(value)
        },
        () => {
          const error = chrome.runtime.lastError;

          if (error) {
            reject(
              new Error("storage_write_failed")
            );
            return;
          }

          resolve();
        }
      );
    });
  }

  function retireLegacyPreference() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(
        [LEGACY_STORAGE_KEY],
        () => {
          void chrome.runtime.lastError;
          resolve();
        }
      );
    });
  }

  function normalizeText(value) {
    return typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const style = getComputedStyle(element);

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();

    return rect.width > 0 && rect.height > 0;
  }

  function getVisibleControlText(element) {
    const visibleText = normalizeText(
      element.innerText
    );

    if (visibleText.length > 0) {
      return visibleText;
    }

    return normalizeText(
      element.getAttribute("aria-label")
    );
  }

  function isExactVisibleProLabel(value) {
    const text = normalizeText(value);

    return (
      text === "Pro" ||
      text === "GPT-5.6 Pro"
    );
  }

  function findComposerEditable() {
    const candidates = Array.from(
      document.querySelectorAll(
        EDITABLE_SELECTOR
      )
    ).filter(isVisible);

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      const leftRect =
        left.getBoundingClientRect();
      const rightRect =
        right.getBoundingClientRect();

      return rightRect.bottom - leftRect.bottom;
    });

    return candidates[0];
  }

  function getCandidateScopes(editable) {
    const scopes = [];
    const seen = new Set();

    const add = (element) => {
      if (
        element instanceof Element &&
        !seen.has(element)
      ) {
        seen.add(element);
        scopes.push(element);
      }
    };

    add(editable.closest("form"));

    let cursor = editable.parentElement;

    for (
      let depth = 0;
      cursor && depth < 9;
      depth += 1
    ) {
      add(cursor);

      if (cursor === document.body) {
        break;
      }

      cursor = cursor.parentElement;
    }

    return scopes;
  }

  function scoreModelControl(candidate, editable) {
    if (
      !isVisible(candidate) ||
      candidate.closest(
        `[${ROOT_ATTRIBUTE}]`
      )
    ) {
      return Number.NEGATIVE_INFINITY;
    }

    const visibleLabel =
      getVisibleControlText(candidate);

    if (!isExactVisibleProLabel(visibleLabel)) {
      return Number.NEGATIVE_INFINITY;
    }

    const ariaLabel = normalizeText(
      candidate.getAttribute("aria-label")
    );
    const title = normalizeText(
      candidate.getAttribute("title")
    );
    const testId = normalizeText(
      candidate.getAttribute("data-testid")
    );
    const hasPopup = normalizeText(
      candidate.getAttribute("aria-haspopup")
    ).toLowerCase();

    const semanticText = [
      ariaLabel,
      title,
      testId
    ].join(" ");

    let score = 100;

    if (/\bmodel\b/i.test(semanticText)) {
      score += 80;
    }

    if (
      hasPopup === "menu" ||
      hasPopup === "listbox"
    ) {
      score += 45;
    }

    const candidateRect =
      candidate.getBoundingClientRect();
    const editableRect =
      editable.getBoundingClientRect();

    const horizontalDistance = Math.min(
      Math.abs(
        candidateRect.left -
        editableRect.left
      ),
      Math.abs(
        candidateRect.right -
        editableRect.right
      )
    );

    const verticalDistance = Math.abs(
      candidateRect.bottom -
      editableRect.bottom
    );

    if (
      horizontalDistance < 750 &&
      verticalDistance < 260
    ) {
      score += 40;
    } else {
      score -= 200;
    }

    return score;
  }

  function findComposerModelControl() {
    const editable = findComposerEditable();

    if (!editable) {
      return null;
    }

    let bestCandidate = null;
    let bestScore = 119;

    for (const scope of getCandidateScopes(editable)) {
      const candidates = scope.querySelectorAll(
        MODEL_CONTROL_SELECTOR
      );

      for (const candidate of candidates) {
        const score = scoreModelControl(
          candidate,
          editable
        );

        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }
    }

    return bestCandidate;
  }

  function inspectCurrentModel() {
    const control = findComposerModelControl();

    if (control) {
      return {
        state: "pro",
        control
      };
    }

    const editable = findComposerEditable();

    if (!editable) {
      return {
        state: "unknown",
        control: null
      };
    }

    /*
     * A visible composer with no exact visible Pro model control is treated
     * as non-Pro only if another model-like control can be found.
     */
    for (const scope of getCandidateScopes(editable)) {
      const candidates = scope.querySelectorAll(
        MODEL_CONTROL_SELECTOR
      );

      for (const candidate of candidates) {
        if (
          !isVisible(candidate) ||
          candidate.closest(
            `[${ROOT_ATTRIBUTE}]`
          )
        ) {
          continue;
        }

        const semanticText = [
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.getAttribute("data-testid")
        ]
          .map(normalizeText)
          .join(" ");

        const hasPopup = normalizeText(
          candidate.getAttribute("aria-haspopup")
        ).toLowerCase();

        if (
          /\bmodel\b/i.test(semanticText) ||
          hasPopup === "menu" ||
          hasPopup === "listbox"
        ) {
          const label =
            getVisibleControlText(candidate);

          if (
            label.length > 0 &&
            !isExactVisibleProLabel(label)
          ) {
            return {
              state: "other",
              control: candidate
            };
          }
        }
      }
    }

    return {
      state: "unknown",
      control: null
    };
  }

  function findOpaqueBackground(anchor) {
    let cursor = anchor;

    while (cursor instanceof Element) {
      const style = getComputedStyle(cursor);
      const background = style.backgroundColor;

      if (
        background &&
        background !== "transparent" &&
        background !== "rgba(0, 0, 0, 0)"
      ) {
        return background;
      }

      cursor = cursor.parentElement;
    }

    return "Canvas";
  }

  function applyNativeTokens(target, anchor) {
    if (
      !(target instanceof HTMLElement) ||
      !(anchor instanceof Element)
    ) {
      return;
    }

    const style = getComputedStyle(anchor);
    const borderWidth = Number.parseFloat(
      style.borderWidth
    );
    const hasVisibleBorder =
      style.borderStyle !== "none" &&
      Number.isFinite(borderWidth) &&
      borderWidth > 0 &&
      style.borderColor &&
      style.borderColor !== "transparent" &&
      style.borderColor !==
        "rgba(0, 0, 0, 0)";
    const borderColor =
      hasVisibleBorder
        ? style.borderColor
        : "color-mix(in srgb, currentColor 18%, transparent)";
    const parsedRadius = Number.parseFloat(
      style.borderTopLeftRadius
    );
    const controlRadius =
      Number.isFinite(parsedRadius) &&
      parsedRadius > 0
        ? `${Math.min(parsedRadius, 10)}px`
        : "10px";

    target.style.setProperty(
      "--pe-native-font-family",
      style.fontFamily || "inherit"
    );
    target.style.setProperty(
      "--pe-native-font-size",
      style.fontSize || "14px"
    );
    target.style.setProperty(
      "--pe-native-font-weight",
      style.fontWeight || "500"
    );
    target.style.setProperty(
      "--pe-native-foreground",
      style.color || "CanvasText"
    );
    target.style.setProperty(
      "--pe-native-control-background",
      style.backgroundColor &&
        style.backgroundColor !== "transparent" &&
        style.backgroundColor !==
          "rgba(0, 0, 0, 0)"
        ? style.backgroundColor
        : "transparent"
    );
    target.style.setProperty(
      "--pe-native-surface",
      findOpaqueBackground(anchor)
    );
    target.style.setProperty(
      "--pe-native-border-color",
      borderColor
    );
    target.style.setProperty(
      "--pe-native-control-radius",
      controlRadius
    );
  }

  function removeDuplicateRoots() {
    for (const candidate of document.querySelectorAll(
      `[${ROOT_ATTRIBUTE}]`
    )) {
      if (candidate !== root) {
        candidate.remove();
      }
    }
  }

  function findRootMount(anchor) {
    if (!(anchor instanceof Element)) {
      return null;
    }

    let reference = anchor;
    let parent = anchor.parentElement;

    for (
      let depth = 0;
      parent && depth < 9;
      depth += 1
    ) {
      const style = getComputedStyle(parent);
      const horizontalFlex =
        (
          style.display === "flex" ||
          style.display === "inline-flex"
        ) &&
        (
          style.flexDirection === "row" ||
          style.flexDirection === "row-reverse"
        );
      const horizontalGrid =
        (
          style.display === "grid" ||
          style.display === "inline-grid"
        ) &&
        (
          style.gridAutoFlow === "column" ||
          style.gridAutoFlow ===
            "column dense"
        );

      if (
        (horizontalFlex || horizontalGrid) &&
        !parent.matches(BUTTON_SELECTOR)
      ) {
        return {
          parent,
          reference
        };
      }

      reference = parent;
      parent = parent.parentElement;
    }

    return null;
  }

  function stopPopoverTracking() {
    popoverResizeObserver?.disconnect();
    popoverResizeObserver = null;

    window.visualViewport?.removeEventListener(
      "resize",
      positionPopover
    );
    window.visualViewport?.removeEventListener(
      "scroll",
      positionPopover
    );
  }

  function startPopoverTracking() {
    stopPopoverTracking();

    if (!popover) {
      return;
    }

    if (
      typeof ResizeObserver === "function"
    ) {
      popoverResizeObserver =
        new ResizeObserver(() => {
          positionPopover();
        });

      popoverResizeObserver.observe(popover);

      if (trigger instanceof Element) {
        popoverResizeObserver.observe(trigger);
      }

      if (modelControl instanceof Element) {
        popoverResizeObserver.observe(
          modelControl
        );
      }

      if (
        rootMountParent instanceof Element
      ) {
        popoverResizeObserver.observe(
          rootMountParent
        );
      }
    }

    window.visualViewport?.addEventListener(
      "resize",
      positionPopover
    );
    window.visualViewport?.addEventListener(
      "scroll",
      positionPopover
    );
  }

  function cancelOpeningFocusHandoff() {
    openingFocusEpoch += 1;

    for (const timer of openingFocusTimers) {
      clearTimeout(timer);
    }

    openingFocusTimers = [];
  }

  function focusSelectedRadioForOpening(epoch) {
    if (
      epoch !== openingFocusEpoch ||
      !popover?.isConnected
    ) {
      return;
    }

    const activeElement =
      document.activeElement;

    if (
      activeElement instanceof Node &&
      popover.contains(activeElement)
    ) {
      return;
    }

    focusRadio(preference);
  }

  function beginOpeningFocusHandoff() {
    cancelOpeningFocusHandoff();

    const epoch = openingFocusEpoch;
    const attempt = () => {
      focusSelectedRadioForOpening(epoch);
    };

    queueMicrotask(attempt);

    for (const delay of [50, 150, 300]) {
      openingFocusTimers.push(
        window.setTimeout(attempt, delay)
      );
    }
  }

  function cancelReturnFocusHandoff() {
    returnFocusEpoch += 1;

    if (returnFocusTimer !== null) {
      clearTimeout(returnFocusTimer);
      returnFocusTimer = null;
    }

    if (returnFocusCleanup) {
      const cleanup = returnFocusCleanup;
      returnFocusCleanup = null;
      cleanup();
    }
  }

  function beginReturnFocusHandoff(
    focusTarget
  ) {
    cancelReturnFocusHandoff();

    if (
      !(focusTarget instanceof HTMLElement)
    ) {
      return;
    }

    const epoch = returnFocusEpoch;

    const resolveFocusTarget = () => {
      if (focusTarget.isConnected) {
        return focusTarget;
      }

      if (
        trigger instanceof HTMLElement &&
        trigger.isConnected
      ) {
        return trigger;
      }

      return null;
    };

    const restoreFocus = () => {
      if (epoch !== returnFocusEpoch) {
        return;
      }

      resolveFocusTarget()?.focus();
    };

    const handleFocusIn = () => {
      const currentFocusTarget =
        resolveFocusTarget();

      if (
        epoch !== returnFocusEpoch ||
        document.activeElement ===
          currentFocusTarget
      ) {
        return;
      }

      queueMicrotask(restoreFocus);
    };

    const cancelOnUserIntent = () => {
      cancelReturnFocusHandoff();
    };

    /*
     * Start on the next task, not a microtask. This guarantees that the
     * composer-originating Escape keydown has fully finished dispatching
     * before cancellation listeners are installed or focus is restored.
     * Genuinely subsequent pointer or keyboard intent still cancels the
     * bounded handoff before that intent changes focus.
     */
    window.setTimeout(() => {
      if (epoch !== returnFocusEpoch) {
        return;
      }

      document.addEventListener(
        "focusin",
        handleFocusIn,
        true
      );
      document.addEventListener(
        "pointerdown",
        cancelOnUserIntent,
        true
      );
      document.addEventListener(
        "keydown",
        cancelOnUserIntent,
        true
      );

      returnFocusCleanup = () => {
        document.removeEventListener(
          "focusin",
          handleFocusIn,
          true
        );
        document.removeEventListener(
          "pointerdown",
          cancelOnUserIntent,
          true
        );
        document.removeEventListener(
          "keydown",
          cancelOnUserIntent,
          true
        );
      };

      restoreFocus();
    }, 0);

    returnFocusTimer = window.setTimeout(
      () => {
        if (epoch !== returnFocusEpoch) {
          return;
        }

        restoreFocus();
        cancelReturnFocusHandoff();
      },
      1000
    );
  }

  function closePopover(returnFocus) {
    if (!popover) {
      return;
    }

    cancelReturnFocusHandoff();

    const previousTrigger = trigger;

    cancelOpeningFocusHandoff();
    popoverRenderSignature = null;
    stopPopoverTracking();

    document.removeEventListener(
      "pointerdown",
      handleOutsidePointer,
      true
    );
    window.removeEventListener(
      "resize",
      positionPopover,
      true
    );
    window.removeEventListener(
      "scroll",
      positionPopover,
      true
    );

    popover.remove();
    popover = null;

    previousTrigger?.setAttribute(
      "aria-expanded",
      "false"
    );

    if (
      returnFocus &&
      previousTrigger?.isConnected
    ) {
      beginReturnFocusHandoff(
        previousTrigger
      );
    }
  }

  function removeInjectedUi(returnFocus) {
    closePopover(Boolean(returnFocus));

    if (announcementTimer !== null) {
      clearTimeout(announcementTimer);
      announcementTimer = null;
    }

    if (announcementClearTimer !== null) {
      clearTimeout(announcementClearTimer);
      announcementClearTimer = null;
    }

    if (root?.isConnected) {
      root.remove();
    }

    root = null;
    trigger = null;
    politeLiveRegion = null;
    alertLiveRegion = null;
    rootMountParent = null;
    rootMountReference = null;
  }

  function createInjectedUi(anchor) {
    removeInjectedUi(false);

    const mount = findRootMount(anchor);

    if (!mount) {
      return;
    }

    root = document.createElement("span");
    root.className = "pe-root";
    root.setAttribute(ROOT_ATTRIBUTE, "");

    trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "pe-trigger";
    trigger.setAttribute(
      "aria-haspopup",
      "dialog"
    );
    trigger.setAttribute(
      "aria-expanded",
      "false"
    );
    trigger.setAttribute(
      "aria-controls",
      POPOVER_ID
    );

    politeLiveRegion =
      document.createElement("span");
    politeLiveRegion.className =
      "pe-live-region";
    politeLiveRegion.setAttribute(
      "role",
      "status"
    );
    politeLiveRegion.setAttribute(
      "aria-atomic",
      "true"
    );

    alertLiveRegion =
      document.createElement("span");
    alertLiveRegion.className =
      "pe-live-region";
    alertLiveRegion.setAttribute(
      "role",
      "alert"
    );
    alertLiveRegion.setAttribute(
      "aria-atomic",
      "true"
    );

    trigger.addEventListener("click", () => {
      if (popover) {
        closePopover(true);
      } else {
        openPopover();
      }
    });

    root.append(
      trigger,
      politeLiveRegion,
      alertLiveRegion
    );

    rootMountParent = mount.parent;
    rootMountReference = mount.reference;

    rootMountReference.insertAdjacentElement(
      "afterend",
      root
    );

    applyNativeTokens(root, anchor);
    renderUi();

    /*
     * ChatGPT can replace the composer-control branch while handling Escape
     * from its textbox. Preserve the active bounded return-focus handoff and
     * transfer focus to the newly mounted trigger immediately.
     */
    if (
      returnFocusTimer !== null ||
      returnFocusCleanup
    ) {
      queueMicrotask(() => {
        if (
          (
            returnFocusTimer !== null ||
            returnFocusCleanup
          ) &&
          trigger?.isConnected
        ) {
          trigger.focus();
        }
      });
    }
  }

  function announceViewState() {
    const signature = JSON.stringify([
      viewState.kind,
      viewState.label,
      viewState.message
    ]);

    if (
      signature ===
      lastAnnouncementSignature
    ) {
      return;
    }

    lastAnnouncementSignature = signature;

    if (announcementTimer !== null) {
      clearTimeout(announcementTimer);
      announcementTimer = null;
    }

    if (announcementClearTimer !== null) {
      clearTimeout(announcementClearTimer);
      announcementClearTimer = null;
    }

    if (
      !politeLiveRegion?.isConnected ||
      !alertLiveRegion?.isConnected
    ) {
      return;
    }

    politeLiveRegion.textContent = "";
    alertLiveRegion.textContent = "";

    const target =
      viewState.kind === "error"
        ? alertLiveRegion
        : politeLiveRegion;
    const announcement = normalizeText(
      `${viewState.label}. ${viewState.message}`
    );

    if (announcement.length === 0) {
      return;
    }

    /*
     * The stable live regions already exist in the accessibility tree.
     * Populate the appropriate one on the next task so polite status
     * changes are announced reliably and errors are announced once through
     * the dedicated alert region.
     */
    announcementTimer = window.setTimeout(
      () => {
        announcementTimer = null;

        if (
          signature !==
            lastAnnouncementSignature ||
          !target.isConnected
        ) {
          return;
        }

        target.textContent = announcement;

        announcementClearTimer =
          window.setTimeout(() => {
            announcementClearTimer = null;

            if (
              signature ===
                lastAnnouncementSignature &&
              target.isConnected &&
              target.textContent ===
                announcement
            ) {
              target.textContent = "";
            }
          }, 1000);
      },
      0
    );
  }

  function setViewState(nextState) {
    viewState = {
      ...viewState,
      ...nextState
    };

    renderUi();
    announceViewState();
  }

  function getEffectiveTriggerPreference() {
    return preference;
  }

  function renderTrigger() {
    if (!trigger) {
      return;
    }

    const displayedPreference =
      getEffectiveTriggerPreference();
    const preferenceLabel =
      displayedPreference === EXTENDED
        ? "Extended"
        : "Standard";

    trigger.textContent = preferenceLabel;
    trigger.dataset.preference =
      displayedPreference;
    trigger.setAttribute(
      "aria-label",
      `Pro effort: ${preferenceLabel}`
    );
  }

  function createRadioOption(
    value,
    title
  ) {
    const selected = preference === value;
    const option = document.createElement("button");

    option.type = "button";
    option.className = "pe-option";
    option.dataset.value = value;
    option.setAttribute("role", "radio");
    option.setAttribute(
      "aria-checked",
      String(selected)
    );
    option.setAttribute(
      "aria-disabled",
      String(submissionBusy)
    );
    option.tabIndex = selected ? 0 : -1;

    const optionTitle =
      document.createElement("span");
    optionTitle.className =
      "pe-option-title";
    optionTitle.textContent = title;

    const optionCheck =
      document.createElement("span");
    optionCheck.className =
      "pe-option-check";
    optionCheck.setAttribute(
      "aria-hidden",
      "true"
    );
    optionCheck.textContent = "✓";

    option.append(
      optionTitle,
      optionCheck
    );

    option.addEventListener("click", () => {
      if (submissionBusy) {
        return;
      }

      void selectPreference(value, true);
    });

    return option;
  }

  function focusRadio(value) {
    const option = popover?.querySelector(
      `.pe-option[data-value="${value}"]`
    );

    if (option instanceof HTMLElement) {
      option.focus();
    }
  }

  function handleRadioGroupKeydown(event) {
    const values = [STANDARD, EXTENDED];
    const currentValue =
      event.target instanceof Element
        ? event.target
            .closest(".pe-option")
            ?.getAttribute("data-value")
        : null;

    let targetValue = null;

    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp" ||
      event.key === "Home"
    ) {
      targetValue = values[0];
    }

    if (
      event.key === "ArrowRight" ||
      event.key === "ArrowDown" ||
      event.key === "End"
    ) {
      targetValue = values[1];
    }

    if (!targetValue) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (targetValue === currentValue) {
      focusRadio(targetValue);
      return;
    }

    void selectPreference(
      targetValue,
      true
    );
  }

  function renderPopoverContents() {
    if (!popover) {
      return;
    }

    const nextRenderSignature =
      JSON.stringify([
        preference,
        submissionBusy
      ]);

    if (
      nextRenderSignature ===
      popoverRenderSignature
    ) {
      return;
    }

    let focusSelector = null;
    const activeElement =
      document.activeElement;

    if (
      activeElement instanceof Element &&
      popover.contains(activeElement)
    ) {
      const activeOption =
        activeElement.closest(".pe-option");
      const activeOptionValue =
        activeOption?.getAttribute(
          "data-value"
        );

      if (
        activeOptionValue === STANDARD ||
        activeOptionValue === EXTENDED
      ) {
        focusSelector =
          `.pe-option[data-value="${activeOptionValue}"]`;
      }
    }

    popoverRenderSignature =
      nextRenderSignature;
    popover.replaceChildren();

    const group = document.createElement("div");
    group.className = "pe-options";
    group.setAttribute("role", "radiogroup");
    group.setAttribute(
      "aria-label",
      "Pro effort"
    );
    group.addEventListener(
      "keydown",
      handleRadioGroupKeydown
    );

    group.append(
      createRadioOption(
        STANDARD,
        "Standard"
      ),
      createRadioOption(
        EXTENDED,
        "Extended"
      )
    );

    popover.append(group);

    positionPopover();

    if (focusSelector) {
      queueMicrotask(() => {
        const focusTarget =
          popover?.querySelector(
            focusSelector
          );

        if (
          focusTarget instanceof HTMLElement
        ) {
          focusTarget.focus();
        }
      });
    }
  }

  function renderUi() {
    renderTrigger();
    renderPopoverContents();
  }

  function positionPopover() {
    if (!popover || !trigger) {
      return;
    }

    const triggerRect =
      trigger.getBoundingClientRect();
    const margin = 8;
    const viewportPadding = 12;
    const visualViewport =
      window.visualViewport;
    const viewportLeft =
      visualViewport?.offsetLeft ?? 0;
    const viewportTop =
      visualViewport?.offsetTop ?? 0;
    const viewportWidth =
      visualViewport?.width ??
      window.innerWidth;
    const viewportHeight =
      visualViewport?.height ??
      window.innerHeight;
    const viewportRight =
      viewportLeft + viewportWidth;
    const viewportBottom =
      viewportTop + viewportHeight;
    const maximumHeight = Math.max(
      64,
      viewportHeight -
        viewportPadding * 2
    );

    popover.style.left = "0px";
    popover.style.top = "0px";
    popover.style.maxHeight =
      `${Math.floor(maximumHeight)}px`;

    const popoverRect =
      popover.getBoundingClientRect();

    let left =
      triggerRect.right -
      popoverRect.width;
    let top = triggerRect.bottom + margin;

    if (
      left + popoverRect.width >
      viewportRight - viewportPadding
    ) {
      left =
        viewportRight -
        popoverRect.width -
        viewportPadding;
    }

    if (
      left <
      viewportLeft + viewportPadding
    ) {
      left =
        viewportLeft + viewportPadding;
    }

    if (
      top + popoverRect.height >
      viewportBottom - viewportPadding
    ) {
      top =
        triggerRect.top -
        popoverRect.height -
        margin;
    }

    if (
      top <
      viewportTop + viewportPadding
    ) {
      top =
        viewportTop + viewportPadding;
    }

    popover.style.left =
      `${Math.round(left)}px`;
    popover.style.top =
      `${Math.round(top)}px`;
  }

  function handleOutsidePointer(event) {
    if (
      !popover ||
      !(event.target instanceof Node)
    ) {
      return;
    }

    cancelOpeningFocusHandoff();

    if (
      popover.contains(event.target) ||
      root?.contains(event.target)
    ) {
      return;
    }

    closePopover(false);
  }

  function handlePopoverKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closePopover(true);
  }

  function openPopover() {
    if (!root || !trigger || popover) {
      return;
    }

    cancelReturnFocusHandoff();

    popover = document.createElement("div");
    popoverRenderSignature = null;
    popover.id = POPOVER_ID;
    popover.className = "pe-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute(
      "aria-modal",
      "false"
    );
    popover.setAttribute(
      "aria-label",
      "Pro effort"
    );
    popover.addEventListener(
      "keydown",
      handlePopoverKeydown
    );

    document.body.append(popover);

    if (modelControl) {
      applyNativeTokens(
        popover,
        modelControl
      );
    }

    trigger.setAttribute(
      "aria-expanded",
      "true"
    );

    renderPopoverContents();
    positionPopover();

    document.addEventListener(
      "pointerdown",
      handleOutsidePointer,
      true
    );
    window.addEventListener(
      "resize",
      positionPopover,
      true
    );
    window.addEventListener(
      "scroll",
      positionPopover,
      true
    );

    startPopoverTracking();
    beginOpeningFocusHandoff();
  }

  function showToast(
    message,
    announce = true
  ) {
    document
      .querySelector(`[${TOAST_ATTRIBUTE}]`)
      ?.remove();

    if (toastTimer !== null) {
      clearTimeout(toastTimer);
    }

    const toast = document.createElement("div");
    toast.className = "pe-toast";
    toast.setAttribute(
      TOAST_ATTRIBUTE,
      ""
    );

    if (
      announce ||
      !alertLiveRegion?.isConnected
    ) {
      toast.setAttribute("role", "alert");
      toast.setAttribute(
        "aria-atomic",
        "true"
      );
    }

    toast.textContent = message;

    document.body.append(toast);

    toastTimer = window.setTimeout(() => {
      toast.remove();
      toastTimer = null;
    }, 7000);
  }

  function sameRouteLocation(left, right) {
    return (
      sameChatRoute(left, right) &&
      left?.pathname === right?.pathname
    );
  }

  function getExtendedReadyMessage() {
    if (activeRoute.kind === "conversation") {
      return (
        "Extended mode is active for this chat. " +
        "Each normal Pro composer submission uses a fresh one-shot gate."
      );
    }

    return (
      "Extended mode is active for this new chat. " +
      "Its first successful normal Pro composer submission will bind Extended to the created chat."
    );
  }

  function setNeutralModeView() {
    rememberRetiredGeneration(
      currentGenerationId
    );
    currentGenerationId = null;

    if (preference === EXTENDED) {
      setViewState({
        kind: "ready",
        label: "Extended",
        message:
          getExtendedReadyMessage(),
        canVerify: false,
        submittedUserMessageId: null
      });
      return;
    }

    setViewState({
      kind: "standard",
      label: "Standard",
      message:
        activeRoute.kind ===
        "conversation"
          ? "ChatGPT requests in this chat are left untouched."
          : "New-chat requests are left untouched.",
      canVerify: false,
      submittedUserMessageId: null
    });
  }

  function rememberRetiredGeneration(
    generationId
  ) {
    if (
      typeof generationId !== "string" ||
      generationId.length === 0
    ) {
      return;
    }

    retiredGenerationIds.add(
      generationId
    );

    while (
      retiredGenerationIds.size > 32
    ) {
      const oldest =
        retiredGenerationIds
          .values()
          .next().value;

      retiredGenerationIds.delete(
        oldest
      );
    }
  }

  function isTerminalStatusPhase(phase) {
    return [
      "sent",
      "warning",
      "verified",
      "failed"
    ].includes(phase);
  }

  function clearDraftAdoption(
    generationId = null
  ) {
    if (!draftAdoption) {
      return;
    }

    if (
      generationId &&
      draftAdoption.generationId &&
      draftAdoption.generationId !==
        generationId
    ) {
      return;
    }

    draftAdoption = null;
  }

  function collectKnownConversationStorageKeys() {
    const storageKeys = new Set();

    for (const anchor of document.querySelectorAll(
      "a[href]"
    )) {
      if (!(anchor instanceof HTMLAnchorElement)) {
        continue;
      }

      const route = parseChatRoute(
        anchor.href
      );

      if (
        route.kind === "conversation" &&
        typeof route.storageKey ===
          "string"
      ) {
        storageKeys.add(route.storageKey);
      }
    }

    return storageKeys;
  }

  function markDraftAdoptionNavigation(
    event
  ) {
    if (
      !draftAdoption ||
      !(event.target instanceof Element)
    ) {
      return;
    }

    const anchor =
      event.target.closest("a[href]");

    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const route = parseChatRoute(
      anchor.href
    );

    if (route.kind === "conversation") {
      draftAdoption.navigationDisqualified =
        true;
    }
  }

  async function maybeAdoptDraftMode() {
    const adoption = draftAdoption;

    if (
      !adoption ||
      adoption.binding ||
      !adoption.targetRoute ||
      !shouldAdoptDraftMode({
        fromRoute: adoption.sourceRoute,
        toRoute: adoption.targetRoute,
        draftMode: adoption.draftMode,
        activeDraftSend:
          adoption.replayStarted,
        sendSucceeded:
          adoption.sendSucceeded,
        alreadyAdopted:
          adoption.adopted,
        targetWasPreexisting:
          adoption.preexistingConversationKeys.has(
            adoption.targetRoute.storageKey
          ),
        navigationDisqualified:
          adoption.navigationDisqualified
      })
    ) {
      return;
    }

    adoption.binding = true;

    try {
      await storageSetMode(
        adoption.targetRoute.storageKey,
        EXTENDED
      );
    } catch {
      adoption.binding = false;

      showToast(
        "The successful Extended send could not be bound persistently to the new chat."
      );
      return;
    }

    adoption.adopted = true;
    draftPreference = STANDARD;

    if (
      activeRoute.kind ===
        "conversation" &&
      activeRoute.storageKey ===
        adoption.targetRoute.storageKey
    ) {
      preference = EXTENDED;
      routeLoaded = true;
      renderUi();
      scheduleScan();
    }

    if (draftAdoption === adoption) {
      draftAdoption = null;
    }
  }

  function markDraftSendSucceeded(
    generationId
  ) {
    if (
      !draftAdoption ||
      !draftAdoption.replayStarted ||
      typeof generationId !== "string" ||
      generationId.length === 0 ||
      draftAdoption.generationId !==
        generationId
    ) {
      return;
    }

    draftAdoption.sendSucceeded = true;
    void maybeAdoptDraftMode();
  }

  async function refreshConversationMode(
    expectedRoute,
    expectedRouteEpoch
  ) {
    let nextPreference;

    try {
      nextPreference =
        await storageGetMode(
          expectedRoute.storageKey
        );
    } catch {
      if (
        expectedRouteEpoch ===
          routeEpoch &&
        sameRouteLocation(
          activeRoute,
          expectedRoute
        )
      ) {
        routeLoaded = false;
      }

      return;
    }

    if (
      expectedRouteEpoch !== routeEpoch ||
      !sameRouteLocation(
        activeRoute,
        expectedRoute
      ) ||
      !sameRouteLocation(
        parseChatRoute(
          window.location.href
        ),
        expectedRoute
      )
    ) {
      return;
    }

    preference = nextPreference;
    routeLoaded = true;
    renderUi();
    scheduleScan();
  }

  async function performRouteModeLoad(
    nextRoute,
    force
  ) {
    const loadSerial =
      ++routeLoadSerial;
    const previousRoute = activeRoute;
    const routeChanged =
      !sameRouteLocation(
        previousRoute,
        nextRoute
      );

    if (
      !force &&
      !routeChanged &&
      routeLoaded
    ) {
      return true;
    }

    if (routeChanged) {
      routeEpoch += 1;

      const adoptionTransition =
        draftAdoption &&
        isDraftAdoptionTarget({
          fromRoute:
            draftAdoption.sourceRoute,
          toRoute: nextRoute,
          draftMode:
            draftAdoption.draftMode,
          activeDraftSend:
            draftAdoption.replayStarted,
          alreadyAdopted:
            draftAdoption.adopted,
          targetWasPreexisting:
            draftAdoption
              .preexistingConversationKeys
              .has(nextRoute.storageKey),
          navigationDisqualified:
            draftAdoption
              .navigationDisqualified
        }) &&
        sameRouteLocation(
          previousRoute,
          draftAdoption.sourceRoute
        );

      activeRoute = nextRoute;

      if (adoptionTransition) {
        draftAdoption.targetRoute =
          nextRoute;
        preference = EXTENDED;
        routeLoaded = true;

        renderUi();
        scheduleScan();
        await maybeAdoptDraftMode();

        return (
          loadSerial === routeLoadSerial &&
          sameRouteLocation(
            activeRoute,
            nextRoute
          ) &&
          sameRouteLocation(
            parseChatRoute(
              window.location.href
            ),
            nextRoute
          )
        );
      }

      if (currentGenerationId) {
        rememberRetiredGeneration(
          currentGenerationId
        );
      }

      if (submissionBusy) {
        navigationInvalidatedOperation =
          true;
      }

      currentGenerationId = null;
      clearDraftAdoption();

      if (
        nextRoute.kind === "draft" &&
        previousRoute.kind !== "draft"
      ) {
        draftPreference = STANDARD;
      }

      preference =
        nextRoute.kind === "draft"
          ? draftPreference
          : STANDARD;
      routeLoaded = false;
      setNeutralModeView();
    } else {
      activeRoute = nextRoute;
      routeLoaded = false;
    }

    let loadedPreference;

    try {
      if (
        nextRoute.kind === "conversation"
      ) {
        loadedPreference =
          await storageGetMode(
            nextRoute.storageKey
          );
      } else {
        loadedPreference =
          normalizeMode(draftPreference);
      }
    } catch {
      if (
        loadSerial === routeLoadSerial &&
        sameRouteLocation(
          activeRoute,
          nextRoute
        ) &&
        sameRouteLocation(
          parseChatRoute(
            window.location.href
          ),
          nextRoute
        )
      ) {
        routeLoaded = false;
      }

      return false;
    }

    if (
      loadSerial !== routeLoadSerial ||
      !sameRouteLocation(
        activeRoute,
        nextRoute
      ) ||
      !sameRouteLocation(
        parseChatRoute(
          window.location.href
        ),
        nextRoute
      )
    ) {
      return false;
    }

    preference = loadedPreference;
    routeLoaded = true;
    setNeutralModeView();
    scheduleScan();

    if (preference === EXTENDED) {
      await restoreBackgroundState(
        routeEpoch
      );
    }

    return true;
  }

  function loadRouteMode(
    nextRoute =
      parseChatRoute(
        window.location.href
      ),
    force = false
  ) {
    if (
      !force &&
      routeLoadPromise &&
      routeLoadTarget &&
      sameRouteLocation(
        routeLoadTarget,
        nextRoute
      )
    ) {
      return routeLoadPromise;
    }

    const promise =
      performRouteModeLoad(
        nextRoute,
        force
      );

    routeLoadTarget = nextRoute;
    routeLoadPromise = promise;

    void promise.finally(() => {
      if (routeLoadPromise === promise) {
        routeLoadPromise = null;
        routeLoadTarget = null;
      }
    });

    return promise;
  }

  function synchronizeRoute() {
    return loadRouteMode(
      parseChatRoute(
        window.location.href
      )
    );
  }

  async function selectPreference(
    value,
    restoreFocus
  ) {
    if (
      submissionBusy ||
      ![STANDARD, EXTENDED].includes(value)
    ) {
      return;
    }

    const routeReady =
      await synchronizeRoute();

    if (!routeReady || !routeLoaded) {
      showToast(
        "The current chat mode could not be loaded. The selection was not changed."
      );
      return;
    }

    const selectionRoute = activeRoute;

    if (
      selectionRoute.kind ===
      "conversation"
    ) {
      try {
        await storageSetMode(
          selectionRoute.storageKey,
          value
        );
      } catch {
        showToast(
          "The chat mode could not be saved. Its previous mode remains active."
        );
        return;
      }
    } else {
      draftPreference = value;
    }

    if (
      !sameRouteLocation(
        activeRoute,
        selectionRoute
      ) ||
      !sameRouteLocation(
        parseChatRoute(
          window.location.href
        ),
        selectionRoute
      )
    ) {
      return;
    }

    preference = value;
    currentGenerationId = null;
    setNeutralModeView();

    queueMicrotask(() => {
      if (restoreFocus && popover) {
        focusRadio(value);
      }
    });
  }

  function scheduleScan() {
    if (scanScheduled) {
      return;
    }

    scanScheduled = true;

    window.setTimeout(() => {
      scanScheduled = false;
      scanModelAndUi();
    }, 40);
  }

  function scanModelAndUi() {
    const currentRoute =
      parseChatRoute(
        window.location.href
      );

    if (
      !routeLoaded ||
      !sameRouteLocation(
        currentRoute,
        activeRoute
      )
    ) {
      void loadRouteMode(currentRoute);
      return;
    }

    removeDuplicateRoots();

    const inspection = inspectCurrentModel();

    modelState = inspection.state;
    modelControl = inspection.control;

    if (
      modelState !== "pro" ||
      !modelControl
    ) {
      removeInjectedUi(false);
      return;
    }

    const mount = findRootMount(
      modelControl
    );

    if (!mount) {
      removeInjectedUi(false);
      return;
    }

    if (
      !root ||
      !root.isConnected ||
      rootMountParent !== mount.parent ||
      rootMountReference !==
        mount.reference ||
      root.parentElement !== mount.parent ||
      root.previousElementSibling !==
        mount.reference
    ) {
      createInjectedUi(modelControl);
      return;
    }

    applyNativeTokens(root, modelControl);

    if (popover) {
      applyNativeTokens(
        popover,
        modelControl
      );
      positionPopover();
    }

    renderUi();
  }

  function getEditableForTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    if (target.matches(EDITABLE_SELECTOR)) {
      return target;
    }

    return target.closest(
      EDITABLE_SELECTOR
    );
  }

  function buttonBelongsToComposer(
    button,
    editable
  ) {
    const form =
      button instanceof HTMLButtonElement
        ? button.form
        : button.closest("form");

    if (form && form.contains(editable)) {
      return true;
    }

    const buttonRect =
      button.getBoundingClientRect();
    const editableRect =
      editable.getBoundingClientRect();

    return (
      Math.abs(
        buttonRect.bottom -
        editableRect.bottom
      ) < 180 &&
      Math.abs(
        buttonRect.left -
        editableRect.right
      ) < 520
    );
  }

  function isSendButton(button) {
    if (
      !(button instanceof Element) ||
      !isVisible(button) ||
      button.closest(
        `[${ROOT_ATTRIBUTE}]`
      )
    ) {
      return false;
    }

    if (
      button instanceof HTMLButtonElement &&
      button.disabled
    ) {
      return false;
    }

    const editable = findComposerEditable();

    if (
      !editable ||
      !buttonBelongsToComposer(
        button,
        editable
      )
    ) {
      return false;
    }

    const semantics = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.getAttribute("name")
    ]
      .map(normalizeText)
      .join(" ");

    if (/\b(send|submit)\b/i.test(semantics)) {
      return true;
    }

    return (
      button instanceof HTMLButtonElement &&
      button.type === "submit"
    );
  }

  function findSendButton() {
    const editable = findComposerEditable();

    if (!editable) {
      return null;
    }

    for (const scope of getCandidateScopes(editable)) {
      for (const candidate of scope.querySelectorAll(
        BUTTON_SELECTOR
      )) {
        if (isSendButton(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  function getComposerForm() {
    return (
      findComposerEditable()?.closest("form") ??
      null
    );
  }

  function stopSubmissionEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function decideSubmissionPolicy() {
    const inspection = inspectCurrentModel();

    modelState = inspection.state;
    modelControl = inspection.control;

    return decideSubmissionForMode(
      preference,
      inspection.state
    ).policy;
  }

  function showUnknownModelBlock(
    event = null
  ) {
    if (event) {
      stopSubmissionEvent(event);
    }

    const message =
      "Extended is selected, but the extension cannot confirm the exact visible Pro model. Submission was blocked.";

    setViewState({
      kind: "error",
      label: "Extended blocked",
      message,
      canVerify: false,
      submittedUserMessageId: null
    });

    showToast(message, false);
  }

  function createReplayDescriptor(
    kind,
    button = null,
    form = null,
    submitter = null
  ) {
    return {
      kind,
      button,
      form,
      submitter
    };
  }

  function replayNormalUiAction(
    descriptor,
    requirePro = true
  ) {
    if (requirePro) {
      const inspection =
        inspectCurrentModel();

      if (inspection.state !== "pro") {
        return false;
      }
    }

    replayDepth += 1;

    try {
      if (
        descriptor.button instanceof HTMLElement &&
        descriptor.button.isConnected &&
        !descriptor.button.matches(":disabled")
      ) {
        descriptor.button.click();
        return true;
      }

      const currentSendButton =
        findSendButton();

      if (currentSendButton) {
        currentSendButton.click();
        return true;
      }

      const form =
        descriptor.form?.isConnected
          ? descriptor.form
          : getComposerForm();

      if (
        form instanceof HTMLFormElement &&
        typeof form.requestSubmit ===
          "function"
      ) {
        if (
          descriptor.submitter instanceof
            HTMLButtonElement &&
          descriptor.submitter.isConnected &&
          descriptor.submitter.form === form
        ) {
          form.requestSubmit(
            descriptor.submitter
          );
        } else {
          form.requestSubmit();
        }

        return true;
      }

      return false;
    } finally {
      replayDepth -= 1;
    }
  }

  function operationRouteIsCurrent(
    operationEpoch,
    operationRoute
  ) {
    return (
      routeEpoch === operationEpoch &&
      sameRouteLocation(
        activeRoute,
        operationRoute
      ) &&
      sameRouteLocation(
        parseChatRoute(
          window.location.href
        ),
        operationRoute
      )
    );
  }

  async function invalidateArmedOperation(
    generationId
  ) {
    const currentRoute =
      parseChatRoute(
        window.location.href
      );

    if (
      !sameRouteLocation(
        activeRoute,
        currentRoute
      )
    ) {
      await loadRouteMode(currentRoute);
    }

    rememberRetiredGeneration(
      generationId
    );
    currentGenerationId = null;
    clearDraftAdoption(generationId);

    try {
      await runtimeSend({
        type: "cancelArm",
        generationId
      });
    } catch {
      // The tab remains blocked until conservative status cleanup arrives.
    }

    await loadRouteMode(
      parseChatRoute(
        window.location.href
      ),
      true
    );
  }

  async function gateAndReplay(descriptor) {
    if (submissionBusy) {
      return;
    }

    const operationEpoch = routeEpoch;
    const operationRoute = activeRoute;

    if (
      operationRoute.kind === "draft" &&
      preference === EXTENDED
    ) {
      draftAdoption = {
        sourceRoute: operationRoute,
        targetRoute: null,
        draftMode: EXTENDED,
        generationId: null,
        replayStarted: false,
        sendSucceeded: false,
        binding: false,
        adopted: false,
        preexistingConversationKeys:
          collectKnownConversationStorageKeys(),
        navigationDisqualified: false
      };
    }

    submissionBusy = true;

    setViewState({
      kind: "arming",
      label: "Arming",
      message:
        "Attaching Chrome's fresh one-shot debugger gate for this Extended-mode submission.",
      canVerify: false,
      submittedUserMessageId: null
    });

    let armResponse;

    try {
      armResponse = await runtimeSend({
        type: "armExtended"
      });
    } catch {
      armResponse = {
        ok: false,
        message:
          "The extension service worker could not arm the one-shot gate."
      };
    }

    if (!armResponse?.ok) {
      submissionBusy = false;
      navigationInvalidatedOperation =
        false;
      clearDraftAdoption();

      if (
        !operationRouteIsCurrent(
          operationEpoch,
          operationRoute
        )
      ) {
        await loadRouteMode(
          parseChatRoute(
            window.location.href
          ),
          true
        );
        return;
      }

      const message =
        armResponse?.message ??
        "Extended could not be armed.";

      setViewState({
        kind: "error",
        label: "Extended blocked",
        message,
        canVerify: false,
        submittedUserMessageId: null
      });

      showToast(message, false);
      return;
    }

    currentGenerationId =
      armResponse.generationId;

    if (draftAdoption) {
      draftAdoption.generationId =
        currentGenerationId;
    }

    if (
      !operationRouteIsCurrent(
        operationEpoch,
        operationRoute
      )
    ) {
      await invalidateArmedOperation(
        currentGenerationId
      );
      return;
    }

    let confirmation;

    try {
      confirmation = await runtimeSend({
        type: "confirmArmed",
        generationId:
          currentGenerationId
      });
    } catch {
      confirmation = {
        ok: false,
        message:
          "The one-shot gate could not be confirmed immediately before replay."
      };
    }

    if (
      !operationRouteIsCurrent(
        operationEpoch,
        operationRoute
      )
    ) {
      await invalidateArmedOperation(
        currentGenerationId
      );
      return;
    }

    if (!confirmation?.ok) {
      try {
        await runtimeSend({
          type: "cancelArm",
          generationId:
            currentGenerationId
        });
      } catch {
        // Background cleanup or timeout remains conservative.
      }

      submissionBusy = false;
      clearDraftAdoption(
        currentGenerationId
      );

      const message =
        confirmation?.message ??
        "The one-shot arm was no longer current.";

      setViewState({
        kind: "error",
        label: "Extended blocked",
        message,
        canVerify: false,
        submittedUserMessageId: null
      });

      showToast(message, false);
      return;
    }

    if (
      draftAdoption &&
      sameRouteLocation(
        draftAdoption.sourceRoute,
        operationRoute
      )
    ) {
      draftAdoption.replayStarted =
        true;
    }

    const replayed =
      replayNormalUiAction(descriptor);

    if (replayed) {
      /*
       * The background service worker owns the 10-second deadline. The busy
       * state is released by a sent, warning, uncertain, or failed status.
       */
      return;
    }

    try {
      await runtimeSend({
        type: "cancelArm",
        generationId:
          currentGenerationId
      });
    } catch {
      // Background timeout remains fail-closed.
    }

    submissionBusy = false;
    clearDraftAdoption(
      currentGenerationId
    );

    const message =
      "ChatGPT's normal submission action could not be replayed after arming.";

    setViewState({
      kind: "error",
      label: "Extended blocked",
      message,
      canVerify: false,
      submittedUserMessageId: null
    });

    showToast(message, false);
  }

  async function resumeCapturedSubmission(
    descriptor,
    expectedRoute
  ) {
    const loaded =
      await loadRouteMode(
        expectedRoute
      );

    if (
      !loaded ||
      !routeLoaded ||
      !sameRouteLocation(
        activeRoute,
        expectedRoute
      ) ||
      !sameRouteLocation(
        parseChatRoute(
          window.location.href
        ),
        expectedRoute
      )
    ) {
      showToast(
        "The chat changed or its mode could not be loaded. Submission was blocked."
      );
      return;
    }

    if (submissionBusy) {
      showToast(
        "A prior Extended operation is still being resolved. Submission was blocked."
      );
      return;
    }

    const policy = decideSubmissionPolicy();

    if (policy === "block_unknown") {
      showUnknownModelBlock();
      return;
    }

    if (policy === "gate") {
      void gateAndReplay(descriptor);
      return;
    }

    if (
      !replayNormalUiAction(
        descriptor,
        false
      )
    ) {
      showToast(
        "ChatGPT's normal submission action could not be replayed after loading this chat's mode."
      );
    }
  }

  function handleCapturedSend(
    event,
    descriptor
  ) {
    if (replayDepth > 0) {
      return;
    }

    if (submissionBusy) {
      stopSubmissionEvent(event);
      return;
    }

    const currentRoute =
      parseChatRoute(
        window.location.href
      );

    if (
      !routeLoaded ||
      !sameRouteLocation(
        activeRoute,
        currentRoute
      )
    ) {
      stopSubmissionEvent(event);

      void resumeCapturedSubmission(
        descriptor,
        currentRoute
      );
      return;
    }

    const policy = decideSubmissionPolicy();

    if (policy === "pass") {
      return;
    }

    if (policy === "block_unknown") {
      showUnknownModelBlock(event);
      return;
    }

    stopSubmissionEvent(event);
    void gateAndReplay(descriptor);
  }

  function handleDocumentClick(event) {
    if (replayDepth > 0) {
      return;
    }

    const button =
      event.target instanceof Element
        ? event.target.closest(
            BUTTON_SELECTOR
          )
        : null;

    if (!button || !isSendButton(button)) {
      return;
    }

    handleCapturedSend(
      event,
      createReplayDescriptor(
        "click",
        button,
        button.closest("form"),
        button instanceof HTMLButtonElement
          ? button
          : null
      )
    );
  }

  function handleDocumentKeydown(event) {
    if (
      popover &&
      event.key === "Escape"
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePopover(true);
      return;
    }

    if (popover) {
      cancelOpeningFocusHandoff();
    }

    if (
      replayDepth > 0 ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return;
    }

    const editable =
      getEditableForTarget(event.target);

    if (
      !editable ||
      editable !== findComposerEditable()
    ) {
      return;
    }

    handleCapturedSend(
      event,
      createReplayDescriptor(
        "keyboard",
        null,
        editable.closest("form"),
        null
      )
    );
  }

  function handleDocumentSubmit(event) {
    if (
      replayDepth > 0 ||
      !(event.target instanceof HTMLFormElement)
    ) {
      return;
    }

    const editable = findComposerEditable();

    if (
      !editable ||
      !event.target.contains(editable)
    ) {
      return;
    }

    handleCapturedSend(
      event,
      createReplayDescriptor(
        "submit",
        null,
        event.target,
        event.submitter instanceof
          HTMLButtonElement
          ? event.submitter
          : null
      )
    );
  }

  function applyStatusMessage(message) {
    if (
      !message ||
      message.source !== MESSAGE_SOURCE ||
      message.type !== "status"
    ) {
      return;
    }

    const generationId =
      typeof message.generationId ===
      "string"
        ? message.generationId
        : null;

    if (
      navigationInvalidatedOperation
    ) {
      rememberRetiredGeneration(
        generationId
      );

      if (
        isTerminalStatusPhase(
          message.phase
        )
      ) {
        submissionBusy = false;
        navigationInvalidatedOperation =
          false;

        if (routeLoaded) {
          setNeutralModeView();
          scheduleScan();
        }
      }

      return;
    }

    if (
      generationId &&
      retiredGenerationIds.has(
        generationId
      )
    ) {
      return;
    }

    if (
      currentGenerationId &&
      message.generationId &&
      currentGenerationId !==
        message.generationId
    ) {
      return;
    }

    if (message.generationId) {
      currentGenerationId =
        message.generationId;
    }

    if (message.phase === "arming") {
      submissionBusy = true;

      setViewState({
        kind: "arming",
        label: message.label ?? "Arming",
        message:
          message.message ??
          "Waiting for one fresh Pro conversation POST.",
        canVerify: false,
        submittedUserMessageId:
          message.submittedUserMessageId ??
          null
      });
      return;
    }

    if (message.phase === "sent") {
      markDraftSendSucceeded(
        generationId
      );
    }

    if (message.phase === "sent") {
      submissionBusy = false;

      setViewState({
        kind: "sent",
        label:
          message.label ??
          "Sent as Extended",
        message:
          message.message ??
          "The fresh paused request was continued as Extended.",
        canVerify:
          message.canVerify === true,
        submittedUserMessageId:
          message.submittedUserMessageId ??
          null
      });
      return;
    }

    if (message.phase === "warning") {
      markDraftSendSucceeded(
        generationId
      );
    }

    if (message.phase === "warning") {
      submissionBusy = false;

      setViewState({
        kind: "warning",
        label:
          message.label ??
          "Sent as Extended; warning",
        message:
          message.message ??
          "The send completed with a debugger cleanup warning.",
        canVerify:
          message.canVerify === true,
        submittedUserMessageId:
          message.submittedUserMessageId ??
          null
      });

      showToast(
        viewState.message,
        false
      );
      return;
    }

    if (message.phase === "verified") {
      markDraftSendSucceeded(
        generationId
      );
    }

    if (message.phase === "verified") {
      submissionBusy = false;

      setViewState({
        kind: "verified",
        label: "Verified Extended",
        message:
          message.message ??
          "The saved response contains durable Extended proof.",
        canVerify: true,
        submittedUserMessageId:
          message.submittedUserMessageId ??
          viewState.submittedUserMessageId
      });
      return;
    }

    if (message.phase === "failed") {
      const failedAdoptionRoute =
        draftAdoption?.targetRoute &&
        sameRouteLocation(
          activeRoute,
          draftAdoption.targetRoute
        )
          ? draftAdoption.targetRoute
          : null;
      const failedAdoptionEpoch =
        routeEpoch;

      clearDraftAdoption(
        generationId
      );

      submissionBusy = false;

      setViewState({
        kind: "error",
        label:
          message.label ??
          "Extended blocked",
        message:
          message.message ??
          "The Extended operation failed closed.",
        canVerify:
          message.canVerify === true,
        submittedUserMessageId:
          message.submittedUserMessageId ??
          null
      });

      showToast(
        viewState.message,
        false
      );

      if (failedAdoptionRoute) {
        void refreshConversationMode(
          failedAdoptionRoute,
          failedAdoptionEpoch
        );
      }
    }
  }

  async function verifyLatestSubmission() {
    if (
      submissionBusy ||
      viewState.kind === "verifying" ||
      !viewState.canVerify ||
      typeof viewState.submittedUserMessageId !==
        "string"
    ) {
      return;
    }

    setViewState({
      kind: "verifying",
      label: "Verifying",
      message:
        "Checking redacted metadata from the saved active conversation branch."
    });

    let response;

    try {
      response = await runtimeSend({
        type: "verifyExtended",
        generationId:
          currentGenerationId
      });
    } catch {
      response = {
        ok: false,
        message:
          "The verification request could not reach the service worker."
      };
    }

    if (response?.ok) {
      setViewState({
        kind: "verified",
        label: "Verified Extended",
        message:
          response.message ??
          "Verified Extended",
        canVerify: true,
        submittedUserMessageId:
          response.submittedUserMessageId ??
          viewState.submittedUserMessageId
      });
      return;
    }

    setViewState({
      kind: "warning",
      label: "Verification unavailable",
      message:
        response?.message ??
        "Durable verification was unavailable. The send state has not been promoted to Verified Extended.",
      canVerify: true,
      submittedUserMessageId:
        response?.submittedUserMessageId ??
        viewState.submittedUserMessageId
    });
  }

  async function restoreBackgroundState(
    expectedRouteEpoch = routeEpoch
  ) {
    if (preference !== EXTENDED) {
      return;
    }

    const expectedRoute = activeRoute;

    let response;

    try {
      response = await runtimeSend({
        type: "getState"
      });
    } catch {
      return;
    }

    if (
      !response?.ok ||
      response.activeOperation !== true ||
      response.pagePath !==
        expectedRoute.pathname ||
      expectedRouteEpoch !== routeEpoch ||
      !sameRouteLocation(
        activeRoute,
        expectedRoute
      ) ||
      !sameRouteLocation(
        parseChatRoute(
          window.location.href
        ),
        expectedRoute
      )
    ) {
      return;
    }

    currentGenerationId =
      response.generationId ?? null;

    applyStatusMessage({
      source: MESSAGE_SOURCE,
      type: "status",
      ...response
    });
  }

  function beginObservation() {
    if (observer) {
      return;
    }

    const target = document.documentElement;

    if (!target) {
      document.addEventListener(
        "DOMContentLoaded",
        beginObservation,
        { once: true }
      );
      return;
    }

    observer = new MutationObserver(() => {
      void synchronizeRoute();
      scheduleScan();
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-label",
        "aria-expanded",
        "aria-pressed",
        "aria-haspopup",
        "data-testid",
        "hidden"
      ]
    });

    scheduleScan();
  }

  document.addEventListener(
    "click",
    markDraftAdoptionNavigation,
    true
  );
  document.addEventListener(
    "click",
    handleDocumentClick,
    true
  );
  document.addEventListener(
    "keydown",
    handleDocumentKeydown,
    true
  );
  document.addEventListener(
    "submit",
    handleDocumentSubmit,
    true
  );

  chrome.runtime.onMessage.addListener(
    (message) => {
      applyStatusMessage(message);
    }
  );

  chrome.storage.onChanged.addListener(
    (changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      const currentRoute =
        parseChatRoute(
          window.location.href
        );

      if (
        !sameRouteLocation(
          activeRoute,
          currentRoute
        )
      ) {
        void loadRouteMode(currentRoute);
        return;
      }

      if (
        !storageChangeAffectsRoute(
          changes,
          activeRoute
        )
      ) {
        return;
      }

      if (!routeLoaded) {
        void loadRouteMode(
          activeRoute,
          true
        );
        return;
      }

      const nextPreference =
        normalizeMode(
          changes[
            activeRoute.storageKey
          ].newValue
        );

      if (nextPreference === preference) {
        return;
      }

      preference = nextPreference;

      if (!submissionBusy) {
        setNeutralModeView();

        if (preference === EXTENDED) {
          void restoreBackgroundState(
            routeEpoch
          );
        }
      } else {
        renderUi();
      }

      scheduleScan();
    }
  );

  window.addEventListener(
    "popstate",
    () => {
      if (draftAdoption) {
        draftAdoption.navigationDisqualified =
          true;
      }

      void synchronizeRoute();
    }
  );

  void retireLegacyPreference().then(
    async () => {
      await loadRouteMode(
        parseChatRoute(
          window.location.href
        ),
        true
      );
      beginObservation();
    }
  );
})();
