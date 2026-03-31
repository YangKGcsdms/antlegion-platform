/**
 * BusWebSocket — Legion Bus WebSocket 事件通道
 * 参考 ant_legion_bus_plugin/src/websocket.ts，简化为 antlegion 所需
 */

import WebSocket from "ws";
import type { BusEvent, AcceptanceFilter } from "../types/protocol.js";
import type { EventQueue } from "./EventQueue.js";

export interface BusWebSocketOptions {
  wsUrl: string;
  antId: string;
  name: string;
  filter: AcceptanceFilter;
  eventQueue: EventQueue;
}

export class BusWebSocket {
  private ws: WebSocket | null = null;
  private options: BusWebSocketOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private connectionAttempts = 0;
  private readonly MAX_ATTEMPTS = 0; // 0 = unlimited
  private readonly MAX_BACKOFF_MS = 30_000;

  constructor(options: BusWebSocketOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.shouldReconnect = true;
    this.connectionAttempts = 0;
    await this.connect();
  }

  stop(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, "shutdown");
      }
      this.ws = null;
    }
  }

  /** 更新连接参数（ant_id 变化时调用） */
  updateOptions(patch: Partial<BusWebSocketOptions>): void {
    Object.assign(this.options, patch);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ──── Private ────

  private connect(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.connectionAttempts++;
      const endpoint = `${this.options.wsUrl}/ws/${this.options.antId}`;
      console.log(`[BusWebSocket] connecting to ${endpoint} (attempt ${this.connectionAttempts})`);

      this.ws = new WebSocket(endpoint);

      this.ws.on("open", () => {
        console.log("[BusWebSocket] connected");
        this.connectionAttempts = 0;
        this.subscribe();
        resolve();
      });

      this.ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("error", (err: Error) => {
        console.error("[BusWebSocket] error:", err.message);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        console.log(`[BusWebSocket] closed: code=${code} reason=${reason.toString()}`);
        this.ws = null;
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
        // 如果还没 resolve 过（连接失败），也 resolve 让调用方不阻塞
        resolve();
      });
    });
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      action: "subscribe",
      name: this.options.name,
      filter: {
        capability_offer: this.options.filter.capability_offer ?? [],
        domain_interests: this.options.filter.domain_interests ?? [],
        fact_type_patterns: this.options.filter.fact_type_patterns ?? [],
        priority_range: this.options.filter.priority_range ?? [0, 7],
        modes: this.options.filter.modes ?? ["exclusive", "broadcast"],
        semantic_kinds: this.options.filter.semantic_kinds ?? [],
        min_epistemic_rank: this.options.filter.min_epistemic_rank ?? -3,
        min_confidence: this.options.filter.min_confidence ?? 0,
        exclude_superseded: this.options.filter.exclude_superseded ?? true,
        subject_key_patterns: this.options.filter.subject_key_patterns ?? [],
      },
    };

    this.ws.send(JSON.stringify(msg));
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);

      // 协议控制消息
      if (msg.status === "subscribed") {
        console.log(`[BusWebSocket] subscribed as ${msg.ant_id}`);
        return;
      }
      if (msg.type === "pong") return;
      if (msg.status === "filter_updated") return;
      if (msg.error) {
        console.error("[BusWebSocket] server error:", msg.error);
        return;
      }

      // 总线事件 → 推入 EventQueue
      const event = msg as BusEvent;
      if (event.event_type) {
        this.options.eventQueue.push(event);
      }
    } catch (err) {
      console.warn("[BusWebSocket] failed to parse message:", err);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.MAX_ATTEMPTS > 0 && this.connectionAttempts >= this.MAX_ATTEMPTS) {
      console.error(`[BusWebSocket] max reconnect attempts (${this.MAX_ATTEMPTS}) reached`);
      return;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    // 指数退避 1s → 30s + jitter
    const backoff = Math.min(1000 * Math.pow(2, this.connectionAttempts - 1), this.MAX_BACKOFF_MS);
    const jitter = Math.random() * 1000;
    const delay = backoff + jitter;

    console.log(`[BusWebSocket] reconnecting in ${Math.round(delay)}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }
}
