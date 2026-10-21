/** Guard SPA links, task switches, browser traversal and reload in desktop browsers. */
export function installUnsavedChangesGuard(isDirty: () => boolean, confirmLeave: () => boolean, root: HTMLElement, preserveTaskPreview = false) {
  let accepted = false;
  const allow = () => !isDirty() || accepted || (accepted = confirmLeave());
  const reset = () => { setTimeout(() => { accepted = false; }, 0); };
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;
    // Document task references keep this editor mounted beneath the preview.
    if (preserveTaskPreview && anchor.hasAttribute("data-task-reference")) return;
    const next = new URL(anchor.href, location.href);
    if (next.pathname === location.pathname && next.search === location.search) return;
    if (!allow()) { event.preventDefault(); event.stopImmediatePropagation(); } else reset();
  };
  const submit = (event: SubmitEvent) => {
    if (event.target instanceof Node && root.contains(event.target)) return;
    if (!allow()) { event.preventDefault(); event.stopImmediatePropagation(); } else reset();
  };
  const before = (event: BeforeUnloadEvent) => { if (isDirty() && !accepted) { event.preventDefault(); event.returnValue = ""; } };
  const navigate = (event: Event) => {
    const navigation = event as Event & { destination?: { url: string }; hashChange?: boolean };
    if (navigation.hashChange || !event.cancelable || navigation.destination?.url === location.href) return;
    if (!allow()) event.preventDefault(); else reset();
  };
  const taskChange = (event: Event) => { if (preserveTaskPreview) return; if (!allow()) event.preventDefault(); else reset(); };
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const originalUrl = location.href, originalState = history.state;
  const pop = (event: PopStateEvent) => {
    if (navigation || !isDirty()) return;
    if (!allow()) { event.stopImmediatePropagation(); history.pushState(originalState, "", originalUrl); }
    else reset();
  };
  document.addEventListener("click", click, true);
  document.addEventListener("submit", submit, true);
  window.addEventListener("beforeunload", before);
  window.addEventListener("agilecampus:before-task-change", taskChange);
  window.addEventListener("popstate", pop, true);
  navigation?.addEventListener("navigate", navigate);
  return () => { document.removeEventListener("click", click, true); document.removeEventListener("submit", submit, true); window.removeEventListener("beforeunload", before); window.removeEventListener("agilecampus:before-task-change", taskChange); window.removeEventListener("popstate", pop, true); navigation?.removeEventListener("navigate", navigate); };
}
