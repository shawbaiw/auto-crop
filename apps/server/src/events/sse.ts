import type { ServerResponse } from "node:http";

export type ServerEvent = {
  type: string;
  companyId?: string;
  taskId?: string;
  message: string;
  status?: string;
  failureReason?: string;
  failureMessage?: string;
  executionProfileName?: string;
  requestedTimeoutMs?: number;
  effectiveTimeoutMs?: number;
  dependencyNote?: string;
  artifactWorkspacePath?: string;
};

export class EventStream {
  private clients = new Map<ServerResponse, string>();

  connect(companyId: string, response: ServerResponse): void {
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    this.clients.set(response, companyId);
    response.on("close", () => {
      this.clients.delete(response);
    });
  }

  publish(event: ServerEvent): void {
    const payload = [`event: ${event.type}`, `data: ${JSON.stringify(event)}`, "", ""].join("\n");

    for (const [client, companyId] of this.clients) {
      if (event.companyId && event.companyId !== companyId) {
        continue;
      }
      client.write(payload);
    }
  }
}
