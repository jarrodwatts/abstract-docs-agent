import { BaseAgent } from "./BaseAgent.js";
import { AgentEventType } from "./types.js";
import cron from "node-cron";

/**
 * An agent that runs on a schedule using cron
 */
export abstract class ScheduledAgent extends BaseAgent {
  protected cronSchedule: string;
  protected cronTask?: cron.ScheduledTask;

  /**
   * @param id Unique identifier for the agent
   * @param name Human-readable name
   * @param description Description of what the agent does
   * @param cronSchedule Cron schedule expression for when to run the agent
   */
  constructor(
    id: string,
    name: string,
    description: string,
    cronSchedule: string
  ) {
    super(id, name, description);
    this.cronSchedule = cronSchedule;
  }

  /**
   * Start the agent on the specified schedule
   */
  protected async onStart(): Promise<void> {
    // Validate the cron schedule
    if (!cron.validate(this.cronSchedule)) {
      const error = new Error(`Invalid cron schedule: ${this.cronSchedule}`);
      this.emitEvent(AgentEventType.AGENT_ERROR, null, error);
      throw error;
    }

    // Schedule the task
    this.cronTask = cron.schedule(this.cronSchedule, async () => {
      try {
        await this.process();
      } catch (error) {
        this.emitEvent(AgentEventType.AGENT_ERROR, null, error as Error);
      }
    });
  }

  /**
   * Stop the scheduled task
   */
  protected async onStop(): Promise<void> {
    if (this.cronTask) {
      this.cronTask.stop();
    }
  }

  /**
   * Update the cron schedule
   */
  updateSchedule(cronSchedule: string): void {
    if (!cron.validate(cronSchedule)) {
      throw new Error(`Invalid cron schedule: ${cronSchedule}`);
    }

    this.cronSchedule = cronSchedule;

    // If the agent is running, restart it with the new schedule
    if (this.isRunning && this.cronTask) {
      this.cronTask.stop();
      this.cronTask = cron.schedule(this.cronSchedule, async () => {
        try {
          await this.process();
        } catch (error) {
          this.emitEvent(AgentEventType.AGENT_ERROR, null, error as Error);
        }
      });
    }
  }
}
