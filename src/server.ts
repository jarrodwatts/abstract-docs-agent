import express from "express";
import dotenv from "dotenv";
import { WebhookDocUpdateAgent } from "./agents/WebhookDocUpdateAgent.js";
import { AgentEventType } from "./core/types.js";

// Load environment variables
dotenv.config();

/**
 * Main entry point for the webhook server
 */
async function main() {
  console.log("Starting Abstract Agents webhook server...");

  try {
    // Create and initialize the Webhook Documentation Update Agent
    const webhookAgent = new WebhookDocUpdateAgent();

    // Subscribe to agent events
    webhookAgent.on(AgentEventType.AGENT_STARTED, (event) => {
      console.log(
        `Agent started: ${event.agentId} at ${event.timestamp.toISOString()}`
      );
    });

    webhookAgent.on(AgentEventType.AGENT_STOPPED, (event) => {
      console.log(
        `Agent stopped: ${event.agentId} at ${event.timestamp.toISOString()}`
      );
    });

    webhookAgent.on(AgentEventType.AGENT_ERROR, (event) => {
      console.error(
        `Agent error: ${event.agentId} at ${event.timestamp.toISOString()}`,
        event.error
      );
    });

    webhookAgent.on(AgentEventType.OUTPUT_DATA_SENT, (event) => {
      console.log(
        `Agent ${event.agentId} sent data at ${event.timestamp.toISOString()}:`,
        event.data
      );
    });

    // Initialize the agent
    await webhookAgent.initialize();

    // Create Express server
    const app = express();

    // Parse raw body for webhook verification
    app.use("/webhook", express.raw({ type: "*/*" }));
    // Parse JSON for other routes
    app.use(express.json());

    // Set up a route for GitHub webhooks with error handling
    app.post("/webhook", async (req, res) => {
      try {
        // Get the event type from headers
        const eventHeader = req.headers["x-github-event"];
        const signatureHeader = req.headers["x-hub-signature-256"];
        const deliveryHeader = req.headers["x-github-delivery"];

        // Ensure headers are strings
        const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
        const signature = Array.isArray(signatureHeader)
          ? signatureHeader[0]
          : signatureHeader;
        const delivery = Array.isArray(deliveryHeader)
          ? deliveryHeader[0]
          : deliveryHeader;

        if (!event || !signature || !delivery) {
          throw new Error("Missing required webhook headers");
        }

        // First verify the webhook with the raw body
        await webhookAgent.webhooks.verify(
          req.body.toString("utf8"), // Convert Buffer to string
          signature
        );

        // Now decode and parse the payload
        const rawBody = req.body.toString("utf8");

        const decodedPayload = decodeURIComponent(
          rawBody.replace(/^payload=/, "")
        );

        // Parse the JSON payload
        const jsonPayload = JSON.parse(decodedPayload);

        // Process the webhook with the parsed payload
        await webhookAgent.webhooks
          .receive({
            id: delivery,
            name: event as "push" | "pull_request",
            payload: jsonPayload,
          })
          .catch((error) => {
            console.error("Error in webhook handler:", error);
            throw error;
          });

        // If we get here, webhook was processed successfully
        res.status(200).json({ message: "Webhook processed successfully" });
      } catch (error: any) {
        console.error("Error processing webhook:", error);
        if (!res.headersSent) {
          if (error.message?.includes("signature")) {
            res.status(401).json({ error: "Invalid webhook signature" });
          } else {
            res.status(500).json({ error: "Error processing webhook" });
          }
        }
      }
    });

    // Add a simple health check endpoint
    app.get("/health", (req, res) => {
      res.status(200).send("Webhook server is running");
    });

    // Start the server
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Webhook server listening on port ${PORT}`);
    });

    // Start the agent
    await webhookAgent.start();

    console.log("Abstract Agents webhook server started successfully");

    // Keep the process running
    process.on("SIGINT", async () => {
      console.log("Shutting down Abstract Agents webhook server...");
      await webhookAgent.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error("Error starting Abstract Agents webhook server:", error);
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error);
