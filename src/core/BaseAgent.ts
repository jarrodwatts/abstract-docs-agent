import { Agent, Source, Output, AgentEventType } from "./types.js";
import { EventEmitter } from "events";

/**
 * Base implementation of an Agent that other agents can extend
 */
export abstract class BaseAgent implements Agent {
  id: string;
  name: string;
  description: string;
  sources: Source[];
  outputs: Output[];
  protected isRunning: boolean = false;
  protected eventEmitter: EventEmitter;
  protected config: Record<string, any> = {};

  constructor(
    id: string,
    name: string,
    description: string,
    sources: Source[] = [],
    outputs: Output[] = []
  ) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.sources = sources;
    this.outputs = outputs;
    this.eventEmitter = new EventEmitter();
  }

  /**
   * Initialize the agent and its sources and outputs
   */
  async initialize(config?: any): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Initialize all sources
    for (const source of this.sources) {
      await source.initialize(this.config);
    }

    // Initialize all outputs
    for (const output of this.outputs) {
      await output.initialize(this.config);
    }

    // Additional initialization logic can be implemented by subclasses
    await this.onInitialize();
  }

  /**
   * Hook for subclasses to implement additional initialization logic
   */
  protected async onInitialize(): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Process data from sources and send to outputs
   * This is the main method that subclasses should implement
   */
  abstract process(): Promise<void>;

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.emitEvent(AgentEventType.AGENT_STARTED);

    // Subclasses should implement the actual running logic
    await this.onStart();
  }

  /**
   * Hook for subclasses to implement start logic
   */
  protected async onStart(): Promise<void> {
    // Default implementation just processes once
    await this.process();
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Cleanup logic for subclasses
    await this.onStop();

    this.emitEvent(AgentEventType.AGENT_STOPPED);
  }

  /**
   * Hook for subclasses to implement stop logic
   */
  protected async onStop(): Promise<void> {
    // Default implementation does nothing
  }

  /**
   * Add a source to the agent
   */
  addSource(source: Source): void {
    this.sources.push(source);
  }

  /**
   * Add an output to the agent
   */
  addOutput(output: Output): void {
    this.outputs.push(output);
  }

  /**
   * Emit an event
   */
  protected emitEvent(type: AgentEventType, data?: any, error?: Error): void {
    const event = {
      type,
      agentId: this.id,
      timestamp: new Date(),
      data,
      error,
    };

    this.eventEmitter.emit(type, event);
  }

  /**
   * Subscribe to agent events
   */
  on(eventType: AgentEventType, callback: (event: any) => void): void {
    this.eventEmitter.on(eventType, callback);
  }
}
