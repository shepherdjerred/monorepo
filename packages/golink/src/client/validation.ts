import { validateShortSlug, validateTargetUrl } from "#shared/contract.ts";

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

type InteractionState = {
  hasInteracted: boolean;
  hasBlurred: boolean;
};

type ValidationSession = {
  form: HTMLFormElement;
  nativeSupported: boolean;
  interactionMap: WeakMap<FormControl, InteractionState>;
  flagged: WeakSet<FormControl>;
  announced: WeakSet<FormControl>;
  announcer: HTMLDivElement;
  announceTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  announcedControl: FormControl | null;
};

const ANNOUNCEMENT_DELAY_MS = 500;

function isFormControl(target: EventTarget | null): FormControl | null {
  if (target instanceof HTMLInputElement) {
    return target;
  }
  if (target instanceof HTMLSelectElement) {
    return target;
  }
  return target instanceof HTMLTextAreaElement ? target : null;
}

function supportsUserInvalidSelector(): boolean {
  try {
    return CSS.supports("selector(:user-invalid)");
  } catch {
    return false;
  }
}

/**
 * Link the field's error message (`data-error`) into `aria-describedby` ONLY
 * while the field is invalid, preserving static hint IDs so hidden error text
 * is never announced prematurely on page load.
 */
export function linkFieldError(control: FormControl, shown: boolean): void {
  const errorId = control.dataset["error"];
  if (errorId === undefined || errorId.length === 0) {
    return;
  }
  const current = control.getAttribute("aria-describedby") ?? "";
  const ids = current
    .split(/\s+/u)
    .filter((id) => id.length > 0 && id !== errorId);
  if (shown) {
    ids.push(errorId);
  }
  if (ids.length > 0) {
    control.setAttribute("aria-describedby", ids.join(" "));
  } else {
    control.removeAttribute("aria-describedby");
  }
}

function spokenText(node: Element): string {
  const clone = node.cloneNode(true);
  if (!(clone instanceof Element)) {
    return "";
  }
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove();
  }
  for (const icon of clone.querySelectorAll('[role="img"][aria-label]')) {
    const label = icon.getAttribute("aria-label") ?? "";
    icon.replaceWith(label.length > 0 ? `${label}: ` : "");
  }
  return clone.textContent.replaceAll(/\s+/gu, " ").trim();
}

function queryElementById(id: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  } catch {
    return document.querySelector<HTMLElement>(
      `[id="${id.replaceAll('"', "")}"]`,
    );
  }
}

function matchesUserInvalid(
  control: FormControl,
  nativeSupported: boolean,
): boolean {
  if (control.classList.contains("user-invalid-fallback")) {
    return true;
  }
  if (!nativeSupported) {
    return false;
  }
  try {
    return control.matches(":user-invalid");
  } catch {
    return false;
  }
}

function clearPendingAnnouncement(session: ValidationSession): void {
  if (session.announceTimer !== undefined) {
    globalThis.clearTimeout(session.announceTimer);
    session.announceTimer = undefined;
  }
  session.announcer.textContent = "";
}

function announceControlError(
  session: ValidationSession,
  control: FormControl,
): void {
  const errorId = control.dataset["error"];
  if (errorId === undefined || errorId.length === 0) {
    return;
  }
  const errorNode = queryElementById(errorId);
  if (errorNode === null) {
    return;
  }
  const firstLabel = control.labels?.[0];
  const labelPrefix =
    firstLabel === undefined ? "" : `${spokenText(firstLabel)}: `;
  clearPendingAnnouncement(session);
  session.announcedControl = control;
  session.announceTimer = globalThis.setTimeout(() => {
    session.announcer.textContent = `${labelPrefix}${spokenText(errorNode)}`;
  }, ANNOUNCEMENT_DELAY_MS);
}

function syncFallbackClasses(
  session: ValidationSession,
  control: FormControl,
): void {
  if (session.nativeSupported) {
    return;
  }
  const valid = control.validity.valid;
  control.classList.toggle("user-invalid-fallback", !valid);
  control.classList.toggle("user-valid-fallback", valid);
}

function syncControlAria(
  session: ValidationSession,
  control: FormControl,
  shouldAnnounce: boolean,
): void {
  if (control.validity.valid) {
    control.classList.remove("user-invalid-fallback");
  }
  if (matchesUserInvalid(control, session.nativeSupported)) {
    if (shouldAnnounce && !session.announced.has(control)) {
      announceControlError(session, control);
      session.announced.add(control);
    }
    control.setAttribute("aria-invalid", "true");
    linkFieldError(control, true);
    session.flagged.add(control);
    return;
  }
  if (
    session.flagged.has(control) ||
    control.getAttribute("aria-invalid") !== "true"
  ) {
    control.setAttribute("aria-invalid", "false");
    linkFieldError(control, false);
    session.flagged.delete(control);
    session.announced.delete(control);
    if (session.announcedControl === control) {
      clearPendingAnnouncement(session);
      session.announcedControl = null;
    }
  }
}

function getOrInitInteraction(
  session: ValidationSession,
  control: FormControl,
): InteractionState {
  const existing = session.interactionMap.get(control);
  if (existing !== undefined) {
    return existing;
  }
  const created: InteractionState = { hasInteracted: false, hasBlurred: false };
  session.interactionMap.set(control, created);
  return created;
}

/**
 * Syncs custom constraints from `#shared/contract.ts` onto native ValidityState
 * so reserved slugs (`api`, `healthz`, etc.) and non-HTTP(S) schemes participate
 * in `:user-invalid` without premature errors on empty fields.
 */
export function syncShortInputValidity(input: HTMLInputElement): string {
  const raw = input.value;
  if (raw.trim().length === 0) {
    input.setCustomValidity("");
    return "Enter a short link name, such as docs or ha.";
  }
  const message = validateShortSlug(raw);
  input.setCustomValidity(message ?? "");
  return (
    message ??
    "Use 1–64 letters, numbers, hyphens, underscores, or periods (starting and ending with a letter or number)."
  );
}

export function syncTargetInputValidity(input: HTMLInputElement): string {
  const raw = input.value;
  if (raw.trim().length === 0) {
    input.setCustomValidity("");
    return "Enter an http:// or https:// destination URL.";
  }
  const message = validateTargetUrl(raw);
  input.setCustomValidity(message ?? "");
  return message ?? "Enter a complete URL starting with https:// or http://.";
}

export function focusFirstInvalidField(form: HTMLFormElement): boolean {
  for (const element of form.elements) {
    const control = isFormControl(element);
    if (control !== null && !control.validity.valid) {
      control.focus();
      return true;
    }
  }
  return false;
}

export function resetFormValidationState(form: HTMLFormElement): void {
  for (const element of form.elements) {
    const control = isFormControl(element);
    if (control !== null) {
      control.setCustomValidity("");
      control.classList.remove("user-invalid-fallback", "user-valid-fallback");
      control.setAttribute("aria-invalid", "false");
      linkFieldError(control, false);
    }
  }
}

/**
 * Attaches `:user-invalid` + `.user-invalid-fallback` ARIA synchronization and
 * a single polite `ui-sr-only` live region (`500ms` post-blur announcement)
 * for `form`. Returns a cleanup function suitable for a React 19 ref callback.
 */
export function bindFormValidation(form: HTMLFormElement): () => void {
  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.className = "ui-sr-only";
  // Inside the modal: everything outside an open dialog is inert to assistive tech.
  (form.closest("dialog") ?? document.body).append(announcer);

  const session: ValidationSession = {
    form,
    nativeSupported: supportsUserInvalidSelector(),
    interactionMap: new WeakMap(),
    flagged: new WeakSet(),
    announced: new WeakSet(),
    announcer,
    announceTimer: undefined,
    announcedControl: null,
  };

  for (const element of form.elements) {
    const control = isFormControl(element);
    if (control !== null) {
      control.setAttribute("aria-invalid", "false");
      linkFieldError(control, false);
    }
  }

  const onBlur = (event: Event): void => {
    const control = isFormControl(event.target);
    if (control === null) {
      return;
    }
    const state = getOrInitInteraction(session, control);
    state.hasBlurred = true;
    if (state.hasInteracted) {
      syncFallbackClasses(session, control);
    }
    syncControlAria(session, control, true);
  };

  const onInput = (event: Event): void => {
    const control = isFormControl(event.target);
    if (control === null) {
      return;
    }
    const state = getOrInitInteraction(session, control);
    state.hasInteracted = true;
    if (state.hasBlurred) {
      syncFallbackClasses(session, control);
    }
    if (control.hasAttribute("aria-invalid")) {
      syncControlAria(session, control, false);
    }
  };

  const onChange = (event: Event): void => {
    const control = isFormControl(event.target);
    if (control === null) {
      return;
    }
    const state = getOrInitInteraction(session, control);
    state.hasInteracted = true;
    if (state.hasBlurred) {
      syncFallbackClasses(session, control);
    }
    syncControlAria(session, control, true);
  };

  const onInvalid = (event: Event): void => {
    const control = isFormControl(event.target);
    if (control === null) {
      return;
    }
    session.interactionMap.set(control, {
      hasInteracted: true,
      hasBlurred: true,
    });
    control.classList.add("user-invalid-fallback");
    control.classList.remove("user-valid-fallback");
    session.announced.add(control);
    syncControlAria(session, control, false);
  };

  const onReset = (): void => {
    globalThis.setTimeout(() => {
      resetFormValidationState(form);
      clearPendingAnnouncement(session);
    }, 0);
  };

  form.addEventListener("blur", onBlur, true);
  form.addEventListener("input", onInput);
  form.addEventListener("change", onChange, true);
  form.addEventListener("invalid", onInvalid, true);
  form.addEventListener("reset", onReset, true);

  return () => {
    form.removeEventListener("blur", onBlur, true);
    form.removeEventListener("input", onInput);
    form.removeEventListener("change", onChange, true);
    form.removeEventListener("invalid", onInvalid, true);
    form.removeEventListener("reset", onReset, true);
    clearPendingAnnouncement(session);
    announcer.remove();
  };
}
