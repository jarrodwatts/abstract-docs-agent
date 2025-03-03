import dotenv from "dotenv";
import { DocUpdateAgent } from "./agents/DocUpdateAgent.js";
import { AgentEventType } from "./core/types.js";

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Abstract Agents system
 */
async function main() {
  console.log("Starting Abstract Agents system...");

  try {
    // Create and initialize the Documentation Update Agent
    const docUpdateAgent = new DocUpdateAgent();

    // Subscribe to agent events
    docUpdateAgent.on(AgentEventType.AGENT_STARTED, (event) => {
      console.log(
        `Agent started: ${event.agentId} at ${event.timestamp.toISOString()}`
      );
    });

    docUpdateAgent.on(AgentEventType.AGENT_STOPPED, (event) => {
      console.log(
        `Agent stopped: ${event.agentId} at ${event.timestamp.toISOString()}`
      );
    });

    docUpdateAgent.on(AgentEventType.AGENT_ERROR, (event) => {
      console.error(
        `Agent error: ${event.agentId} at ${event.timestamp.toISOString()}`,
        event.error
      );
    });

    docUpdateAgent.on(AgentEventType.OUTPUT_DATA_SENT, (event) => {
      console.log(
        `Agent ${event.agentId} sent data at ${event.timestamp.toISOString()}:`,
        event.data
      );
    });

    // Initialize the agent
    await docUpdateAgent.initialize();

    // Start the agent
    await docUpdateAgent.start();

    console.log("Abstract Agents system started successfully");

    // Keep the process running
    process.on("SIGINT", async () => {
      console.log("Shutting down Abstract Agents system...");
      await docUpdateAgent.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error("Error starting Abstract Agents system:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error);
