import type { ModelPricing } from '../types/index.js';
import { calculateCost } from './cost-tracker.js';

export class PipelineLimitError extends Error {}

interface Reservation {
  maximumCost: number;
  closed: boolean;
}

export class ApiBudget {
  private callsStarted = 0;
  private actualCost = 0;
  private reservedCost = 0;
  private haltedReason: string | null = null;

  constructor(
    private readonly maxCalls: number,
    private readonly maxBudgetUsd: number,
    private readonly pricing: ModelPricing,
  ) {}

  reserve(maximumInputTokens: number, maximumOutputTokens: number): Reservation {
    if (this.haltedReason) throw new PipelineLimitError(this.haltedReason);
    if (this.callsStarted >= this.maxCalls) {
      throw new PipelineLimitError(`Maximum API call count reached (${this.maxCalls}).`);
    }

    const maximumCost = calculateCost(maximumInputTokens, maximumOutputTokens, this.pricing);
    if (this.actualCost + this.reservedCost + maximumCost > this.maxBudgetUsd + 1e-12) {
      throw new PipelineLimitError(
        `The next call could exceed the USD ${this.maxBudgetUsd.toFixed(4)} budget.`,
      );
    }

    this.callsStarted += 1;
    this.reservedCost += maximumCost;
    return { maximumCost, closed: false };
  }

  recordSuccess(reservation: Reservation, inputTokens: number, outputTokens: number): number {
    this.closeReservation(reservation);
    const cost = calculateCost(inputTokens, outputTokens, this.pricing);
    this.actualCost += cost;
    if (this.actualCost > this.maxBudgetUsd + 1e-12) {
      this.halt(`Actual API cost reached the USD ${this.maxBudgetUsd.toFixed(4)} budget.`);
    }
    return cost;
  }

  recordFailure(reservation: Reservation): void {
    this.closeReservation(reservation);
  }

  halt(reason: string): void {
    this.haltedReason = reason;
  }

  get calls(): number {
    return this.callsStarted;
  }

  get spentUsd(): number {
    return this.actualCost;
  }

  private closeReservation(reservation: Reservation): void {
    if (reservation.closed) return;
    reservation.closed = true;
    this.reservedCost = Math.max(0, this.reservedCost - reservation.maximumCost);
  }
}
