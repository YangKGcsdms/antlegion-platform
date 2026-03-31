import { ref, onUnmounted } from "vue";
import type { BusEvent } from "../api/client";
import { createWsUrl } from "../api/client";

export function useEventStream(maxEvents = 100) {
  const events = ref<BusEvent[]>([]);
  const connected = ref(false);
  let ws: WebSocket | null = null;

  function connect(antId = "dashboard-ui") {
    const url = `${createWsUrl()}?ant_id=${antId}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      connected.value = true;
      ws?.send(
        JSON.stringify({
          action: "subscribe",
          name: "dashboard",
          filter: {},
        }),
      );
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.event_type) {
          events.value = [data, ...events.value].slice(0, maxEvents);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      connected.value = false;
      // Auto-reconnect after 3s
      setTimeout(() => connect(antId), 3000);
    };

    ws.onerror = () => ws?.close();
  }

  function disconnect() {
    ws?.close();
    ws = null;
  }

  onUnmounted(disconnect);

  return { events, connected, connect, disconnect };
}
