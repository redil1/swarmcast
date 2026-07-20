const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export function closeHttpServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}

export function createServiceLifecycle({
  service,
  logger = null,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  processRef = process,
  exit = (code) => processRef.exit(code)
} = {}) {
  if (typeof service !== "string" || service.trim() === "") throw new Error("service is required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be a positive integer");

  let state = "starting";
  let shutdownFn = null;
  let shutdownTask = null;
  const signalHandlers = new Map();

  function markReady() {
    if (state === "starting") state = "ready";
  }

  function isReady() {
    return state === "ready";
  }

  function removeSignalHandlers() {
    for (const [signal, handler] of signalHandlers) processRef.removeListener(signal, handler);
    signalHandlers.clear();
  }

  function shutdown(signal = "manual") {
    if (shutdownTask) return shutdownTask;
    if (typeof shutdownFn !== "function") throw new Error("shutdown handler is not installed");

    state = "stopping";
    logger?.info("service_shutdown_started", { signal }, `${service} shutdown started`);
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`shutdown exceeded ${timeoutMs}ms`)), timeoutMs);
      timeout.unref?.();
    });

    shutdownTask = Promise.race([
      Promise.resolve().then(() => shutdownFn(signal)),
      deadline
    ]).then(() => {
      clearTimeout(timeout);
      state = "stopped";
      removeSignalHandlers();
      logger?.info("service_shutdown_completed", { signal }, `${service} shutdown completed`);
      exit(0);
    }).catch((error) => {
      clearTimeout(timeout);
      state = "failed";
      removeSignalHandlers();
      logger?.error("service_shutdown_failed", {
        signal,
        error_class: error?.name || "Error",
        error_message: error?.message || String(error)
      }, `${service} shutdown failed`);
      exit(1);
    });
    return shutdownTask;
  }

  function install(handler) {
    if (typeof handler !== "function") throw new Error("shutdown handler must be a function");
    if (shutdownFn) throw new Error("shutdown handler is already installed");
    shutdownFn = handler;
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const signalHandler = () => void shutdown(signal);
      signalHandlers.set(signal, signalHandler);
      processRef.on(signal, signalHandler);
    }
    return removeSignalHandlers;
  }

  return {
    install,
    isReady,
    markReady,
    shutdown,
    state: () => state
  };
}
