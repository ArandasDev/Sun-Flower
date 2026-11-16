export interface EventContext {
  readonly userId?: string;
  readonly channelId?: string;
}

export interface SunFlowerEvent {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly source: string;
  readonly timestamp: string;
  readonly context: EventContext;
  readonly payload: unknown;
}

export type EventHandler = (event: SunFlowerEvent) => Promise<void> | void;
