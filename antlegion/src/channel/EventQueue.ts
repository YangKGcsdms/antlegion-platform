import type { BusEvent } from "../types/protocol.js";

export class EventQueue {
  private queue: BusEvent[] = [];
  private droppedCount = 0;

  constructor(private capacity = 100) {}

  push(event: BusEvent): void {
    if (this.queue.length >= this.capacity) {
      this.queue.shift();
      this.droppedCount++;
      console.warn(`[EventQueue] overflow, dropped oldest (total dropped: ${this.droppedCount})`);
    }
    this.queue.push(event);
  }

  drain(): { events: BusEvent[]; dropped: number } {
    const events = this.queue;
    const dropped = this.droppedCount;
    this.queue = [];
    this.droppedCount = 0;
    return { events, dropped };
  }

  get size(): number {
    return this.queue.length;
  }
}
