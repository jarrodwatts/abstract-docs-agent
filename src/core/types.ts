/**
 * Core types for the Abstract Agents system
 */

// Base interface for all sources of information
export interface Source<T = any> {
  id: string;
  name: string;
  description: string;

  // Initialize the source with configuration
  initialize(config?: any): Promise<void>;

  // Get data from the source
  getData(): Promise<T>;

  // Subscribe to updates (if supported)
  subscribe?(callback: (data: T) => void): Promise<void>;

  // Cleanup resources
  cleanup?(): Promise<void>;
}

// Base interface for all outputs
export interface Output<T = any> {
  id: string;
  name: string;
  description: string;

  // Initialize the output with configuration
  initialize(config?: any): Promise<void>;

  // Send data to the output
  sendData(data: T): Promise<void>;

  // Cleanup resources
  cleanup?(): Promise<void>;
}

// Base interface for all agents
export interface Agent {
  id: string;
  name: string;
  description: string;

  // Sources this agent uses
  sources: Source[];

  // Outputs this agent sends data to
  outputs: Output[];

  // Initialize the agent with configuration
  initialize(config?: any): Promise<void>;

  // Process data from sources and send to outputs
  process(): Promise<void>;

  // Start the agent (may run continuously or on a schedule)
  start(): Promise<void>;

  // Stop the agent
  stop(): Promise<void>;
}

// Configuration for the agent system
export interface AgentSystemConfig {
  agents: Agent[];
  // Global configuration that applies to all agents
  globalConfig?: Record<string, any>;
}

// Event types for the agent system
export enum AgentEventType {
  AGENT_STARTED = "agent_started",
  AGENT_STOPPED = "agent_stopped",
  AGENT_ERROR = "agent_error",
  SOURCE_DATA_RECEIVED = "source_data_received",
  OUTPUT_DATA_SENT = "output_data_sent",
}

// Event interface for the agent system
export interface AgentEvent {
  type: AgentEventType;
  agentId?: string;
  sourceId?: string;
  outputId?: string;
  timestamp: Date;
  data?: any;
  error?: Error;
}
