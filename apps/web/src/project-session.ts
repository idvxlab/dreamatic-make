import type { WorkspaceView } from "@harness/core";

type Stream = Pick<EventSource, "onopen" | "onmessage" | "onerror" | "close">;

/** One project owns one stream and one cancellable request lifetime. */
export function createProjectSession(projectId: string, options: {
  load: (id: string, signal: AbortSignal) => Promise<WorkspaceView>;
  connect: (id: string) => Stream;
  onUpdate: (snapshot: WorkspaceView) => void;
  onError: (message: string) => void;
  onConnected: (connected: boolean) => void;
}) {
  const controller = new AbortController();
  let disposed = false, inFlight = false, again = false;
  const refresh = async () => {
    if (disposed) return;
    if (inFlight) { again = true; return; }
    inFlight = true;
    try {
      const snapshot = await options.load(projectId, controller.signal);
      if (disposed) return;
      if (snapshot.context.projectId !== projectId) throw new Error("Project response does not match the selected project. Reload to try again.");
      options.onUpdate(snapshot);
    } catch (error) {
      if (!disposed) options.onError((error as Error).message);
    } finally {
      inFlight = false;
      if (again && !disposed) { again = false; void refresh(); }
    }
  };
  const stream = options.connect(projectId);
  stream.onopen = () => { if (!disposed) options.onConnected(true); };
  stream.onmessage = () => { if (!disposed) void refresh(); };
  stream.onerror = () => { if (!disposed) options.onConnected(false); };
  void refresh();
  return {
    refresh,
    dispose() {
      disposed = true;
      controller.abort();
      stream.onopen = stream.onmessage = stream.onerror = null;
      stream.close();
    },
  };
}
