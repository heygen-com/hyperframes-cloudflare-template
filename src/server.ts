import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

// Durable Objects must be exported from the Worker entry module.
export { RenderContainer } from "./container";

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
