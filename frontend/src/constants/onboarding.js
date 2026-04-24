export const WORKSPACE_ONBOARDING_KEY = 'vineyard_workspace_onboarding_v1';

export function readWorkspaceOnboarding() {
  if (typeof window === 'undefined') {
    return { hideFab: false, tourDone: false };
  }
  try {
    const raw = localStorage.getItem(WORKSPACE_ONBOARDING_KEY);
    if (!raw) return { hideFab: false, tourDone: false };
    const o = JSON.parse(raw);
    return {
      hideFab: Boolean(o.hideFab),
      tourDone: Boolean(o.tourDone),
    };
  } catch {
    return { hideFab: false, tourDone: false };
  }
}

export function writeWorkspaceOnboarding(patch) {
  if (typeof window === 'undefined') return;
  const next = { ...readWorkspaceOnboarding(), ...patch };
  localStorage.setItem(WORKSPACE_ONBOARDING_KEY, JSON.stringify(next));
}

/** Вызывать после успешной авторизации: снова показать «!» и тур при входе в рабочую область. */
export function resetWorkspaceOnboardingForLogin() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    WORKSPACE_ONBOARDING_KEY,
    JSON.stringify({ hideFab: false, tourDone: false })
  );
}
