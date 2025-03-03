# Abstract Agents

A modular infrastructure for AI agents that perform tasks related to the Abstract blockchain.

## Overview

This project provides a flexible and extensible framework for creating AI agents that can automate various tasks related to the Abstract blockchain ecosystem. The agents are designed to be modular, with clear separation between:

- **Sources**: Where agents get information from (e.g., GitHub repositories, APIs)
- **Outputs**: Where agents send processed information to (e.g., GitHub PRs, Slack messages)
- **Agents**: The core logic that processes information from sources and sends it to outputs

## Current Agents

### Documentation Update Agent

This agent monitors a GitHub repository (e.g., the Abstract Global Wallet SDK) for changes and automatically proposes updates to the Abstract documentation based on those changes. It uses the Vercel AI SDK with OpenAI to analyze code changes and generate appropriate documentation updates.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm
- GitHub token with appropriate permissions

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/yourusername/abstract-agents.git
   cd abstract-agents
   ```

2. Install dependencies:

   ```
   pnpm install
   ```

3. Copy the example environment file and fill in your values:

   ```
   cp .env.example .env
   ```

4. Build the project:
   ```
   pnpm build
   ```

### Running the Agents

To start the agent system with scheduled execution:

```
pnpm start
```

To start the agent system with webhook-based execution:

```
pnpm start:webhook
```

For development with auto-reloading:

```
pnpm dev           # For scheduled execution
pnpm dev:webhook   # For webhook-based execution
```

## Configuration

Configure the agents through environment variables in the `.env` file:

```
# OpenAI API Key for AI SDK
OPENAI_API_KEY=your_openai_api_key_here

# GitHub Configuration
GITHUB_TOKEN=your_github_token_here
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here

# Repository to monitor (for the documentation agent)
MONITOR_REPO_OWNER=abstract
MONITOR_REPO_NAME=agw-sdk

# Documentation repository (where to propose changes)
DOCS_REPO_OWNER=abstract
DOCS_REPO_NAME=docs

# Webhook server configuration (optional)
PORT=3000
```

## Setting Up GitHub Webhooks

To use the webhook-based agent:

1. Start the webhook server:

   ```
   pnpm start:webhook
   ```

2. Make your server publicly accessible (using ngrok, a VPS, or a service like Cloudflare Tunnel)

3. In your GitHub repository settings:

   - Go to "Settings" > "Webhooks" > "Add webhook"
   - Set the Payload URL to your server's URL + "/webhook" (e.g., `https://your-server.com/webhook`)
   - Set the Content type to "application/json"
   - Set the Secret to match your `GITHUB_WEBHOOK_SECRET`
   - Select "Just the push event" (or customize as needed)
   - Enable SSL verification
   - Click "Add webhook"

4. Test the webhook by making a push to your repository

## Architecture

The system is built with a modular architecture:

- **Core**: Base interfaces and classes for the agent system
- **Sources**: Implementations of various data sources
- **Outputs**: Implementations of various output destinations
- **Agents**: Specific agent implementations that use sources and outputs
- **Utils**: Utility functions and services

## Extending the System

### Creating a New Source

Create a new class that implements the `Source` interface:

```typescript
import { Source } from "../core/types";

export class MyCustomSource implements Source<MyDataType> {
  id: string;
  name: string;
  description: string;

  constructor(id: string, name: string, description: string) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async initialize(config?: any): Promise<void> {
    // Initialize your source
  }

  async getData(): Promise<MyDataType> {
    // Get data from your source
    return data;
  }
}
```

### Creating a New Output

Create a new class that implements the `Output` interface:

```typescript
import { Output } from "../core/types";

export class MyCustomOutput implements Output<MyDataType> {
  id: string;
  name: string;
  description: string;

  constructor(id: string, name: string, description: string) {
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async initialize(config?: any): Promise<void> {
    // Initialize your output
  }

  async sendData(data: MyDataType): Promise<void> {
    // Send data to your output
  }
}
```

### Creating a New Agent

Create a new class that extends `BaseAgent` or `ScheduledAgent`:

```typescript
import { ScheduledAgent } from "../core/ScheduledAgent";
import { MyCustomSource } from "../sources/MyCustomSource";
import { MyCustomOutput } from "../outputs/MyCustomOutput";

export class MyCustomAgent extends ScheduledAgent {
  constructor(
    id: string = "my-custom-agent",
    name: string = "My Custom Agent",
    description: string = "Description of what my agent does",
    cronSchedule: string = "0 * * * *" // Run every hour
  ) {
    super(id, name, description, cronSchedule);
  }

  async onInitialize(): Promise<void> {
    // Set up your sources and outputs
    const source = new MyCustomSource("my-source", "My Source", "Description");
    const output = new MyCustomOutput("my-output", "My Output", "Description");

    await source.initialize(this.config);
    await output.initialize(this.config);

    this.addSource(source);
    this.addOutput(output);
  }

  async process(): Promise<void> {
    // Get data from sources
    const source = this.sources[0] as MyCustomSource;
    const data = await source.getData();

    // Process the data
    const processedData = doSomethingWith(data);

    // Send to outputs
    const output = this.outputs[0] as MyCustomOutput;
    await output.sendData(processedData);
  }
}
```

## License

ISC
