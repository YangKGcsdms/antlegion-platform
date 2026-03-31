import { describe, it, expect } from "vitest";
import {
  recordEvent,
  shouldAcceptPublication,
  ErrorEvent,
  DEGRADED_THRESHOLD,
  ISOLATED_THRESHOLD,
} from "../src/engine/ReliabilityManager.js";
import { createAntIdentity, createFact } from "../src/types/protocol.js";

describe("ReliabilityManager", () => {
  describe("recordEvent", () => {
    it("increments TEC on contradiction", () => {
      const ant = createAntIdentity({ state: "active" });
      recordEvent(ant, ErrorEvent.CONTRADICTION);
      expect(ant.transmit_error_counter).toBe(8);
    });

    it("decrements TEC on heartbeat (min 0)", () => {
      const ant = createAntIdentity({
        state: "active",
        transmit_error_counter: 2,
      });
      recordEvent(ant, ErrorEvent.HEARTBEAT_OK);
      expect(ant.transmit_error_counter).toBe(1);

      recordEvent(ant, ErrorEvent.HEARTBEAT_OK);
      expect(ant.transmit_error_counter).toBe(0);

      recordEvent(ant, ErrorEvent.HEARTBEAT_OK);
      expect(ant.transmit_error_counter).toBe(0); // floor at 0
    });

    it("transitions to degraded at threshold", () => {
      const ant = createAntIdentity({
        state: "active",
        transmit_error_counter: DEGRADED_THRESHOLD - 1,
      });
      const newState = recordEvent(ant, ErrorEvent.RATE_EXCEEDED);
      expect(newState).toBe("degraded");
      expect(ant.state).toBe("degraded");
    });

    it("transitions to isolated at threshold", () => {
      const ant = createAntIdentity({
        state: "active",
        transmit_error_counter: ISOLATED_THRESHOLD - 1,
      });
      const newState = recordEvent(ant, ErrorEvent.RATE_EXCEEDED);
      expect(newState).toBe("isolated");
      expect(ant.state).toBe("isolated");
    });

    it("recovers from isolated when TEC drops below degraded", () => {
      const ant = createAntIdentity({
        state: "isolated",
        transmit_error_counter: DEGRADED_THRESHOLD,
      });
      // TEC 128 - 1 = 127 → below DEGRADED_THRESHOLD → active
      const newState = recordEvent(ant, ErrorEvent.HEARTBEAT_OK);
      expect(ant.transmit_error_counter).toBe(DEGRADED_THRESHOLD - 1);
      expect(newState).toBe("active");
      expect(ant.state).toBe("active");
    });

    it("recovers from isolated to degraded", () => {
      const ant = createAntIdentity({
        state: "isolated",
        transmit_error_counter: DEGRADED_THRESHOLD + 1,
      });
      // TEC 129 - 1 = 128 → still >= DEGRADED_THRESHOLD → degraded
      const newState = recordEvent(ant, ErrorEvent.HEARTBEAT_OK);
      expect(ant.transmit_error_counter).toBe(DEGRADED_THRESHOLD);
      expect(newState).toBe("degraded");
    });

    it("does not modify offline ant", () => {
      const ant = createAntIdentity({ state: "offline" });
      const newState = recordEvent(ant, ErrorEvent.CONTRADICTION);
      expect(newState).toBe("offline");
      expect(ant.transmit_error_counter).toBe(0);
    });

    it("updates reliability_score", () => {
      const ant = createAntIdentity({ state: "active" });
      expect(ant.reliability_score).toBe(1.0);

      // TEC = 128 → reliability = 1 - 128/256 = 0.5
      ant.transmit_error_counter = DEGRADED_THRESHOLD - 1;
      recordEvent(ant, ErrorEvent.RATE_EXCEEDED);
      expect(ant.reliability_score).toBe(0.5);

      // TEC >= 256 → reliability = 0.0
      ant.transmit_error_counter = ISOLATED_THRESHOLD - 1;
      recordEvent(ant, ErrorEvent.RATE_EXCEEDED);
      expect(ant.reliability_score).toBe(0.0);
    });
  });

  describe("shouldAcceptPublication", () => {
    it("accepts from active ant", () => {
      const ant = createAntIdentity({ state: "active" });
      const fact = createFact();
      const [ok, reason] = shouldAcceptPublication(ant, fact);
      expect(ok).toBe(true);
    });

    it("rejects from isolated ant", () => {
      const ant = createAntIdentity({ state: "isolated" });
      const [ok] = shouldAcceptPublication(ant, createFact());
      expect(ok).toBe(false);
    });

    it("rejects from offline ant", () => {
      const ant = createAntIdentity({ state: "offline" });
      const [ok] = shouldAcceptPublication(ant, createFact());
      expect(ok).toBe(false);
    });

    it("caps confidence for degraded ant", () => {
      const ant = createAntIdentity({ state: "degraded" });
      const fact = createFact({ confidence: 0.9 });
      const [ok] = shouldAcceptPublication(ant, fact);
      expect(ok).toBe(true);
      expect(fact.confidence).toBe(0.3);
    });

    it("does not increase confidence for degraded ant", () => {
      const ant = createAntIdentity({ state: "degraded" });
      const fact = createFact({ confidence: 0.1 });
      shouldAcceptPublication(ant, fact);
      expect(fact.confidence).toBe(0.1); // already below 0.3
    });
  });
});
