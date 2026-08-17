import type { ServerResponse } from "node:http";

export type ServerEvent = {
  type: string;
  taskId?: string;
  message: string;
};

export class EventStream {
  private clients = new Set<ServerResponse>();

  connect(response: ServerResponse): void {
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    this.clients.add(response);
    response.on("close", () => {
      this.clients.delete(response);
    });
  }

  publish(event: ServerEvent): void {
    const payload = [`event: ${event.type}`, `data: ${JSON.stringify(event)}`, "", ""].join("\n");

    for (const client of this.clients) {
      client.write(payload);
    }
  }
}
