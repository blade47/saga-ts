// Core types - simplified
type StepContext<TResults extends Record<string, unknown>> = {
  results: TResults;
};

type StepFunction<TInput, TOutput, TResults extends Record<string, unknown>> = (
  input: TInput,
  ctx: StepContext<TResults>
) => Promise<TOutput>;

type RollbackFunction<TOutput> = (output: TOutput) => Promise<void>;

type SagaResult<TData, TResults extends Record<string, unknown>> = 
  | { status: 'success'; data: TData; results: TResults }
  | { status: 'failed'; error: Error; failedAt: string };

// Internal step storage
interface StepDefinition
  TInput,
  TOutput,
  TResults extends Record<string, unknown>
> {
  name: string;
  input: TInput;
  execute: StepFunction<TInput, TOutput, TResults>;
  rollback?: RollbackFunction<TOutput>;
}

// Saga Builder - fully typed
class SagaBuilder
  TResults extends Record<string, unknown> = Record<string, never>,
  TLastOutput = undefined
> {
  private steps: StepDefinition<unknown, unknown, Record<string, unknown>>[] = [];

  step
    TName extends string,
    TInput,
    TOutput
  >(
    name: TName extends keyof TResults ? never : TName,
    input: TInput,
    execute: StepFunction<TInput, TOutput, TResults>,
    rollback?: RollbackFunction<TOutput>
  ): SagaBuilder<TResults & Record<TName, TOutput>, TOutput> {
    this.steps.push({
      name,
      input,
      execute: execute as StepFunction<unknown, unknown, Record<string, unknown>>,
      rollback: rollback as RollbackFunction<unknown> | undefined,
    });
    return this as unknown as SagaBuilder<TResults & Record<TName, TOutput>, TOutput>;
  }

  async run(): Promise<SagaResult<TLastOutput, TResults>> {
    const results: Record<string, unknown> = {};
    const executedSteps: Array<{
      name: string;
      output: unknown;
      rollback?: RollbackFunction<unknown>;
    }> = [];

    let lastOutput: unknown = undefined;

    try {
      for (const step of this.steps) {
        try {
          const ctx: StepContext<Record<string, unknown>> = {
            results,
          };

          const output = await step.execute(step.input, ctx);
          
          results[step.name] = output;
          lastOutput = output;
          
          executedSteps.push({
            name: step.name,
            output,
            rollback: step.rollback,
          });
        } catch (error) {
          await this.rollback(executedSteps);

          return {
            status: 'failed',
            error: error instanceof Error ? error : new Error(String(error)),
            failedAt: step.name,
          };
        }
      }

      return {
        status: 'success',
        data: lastOutput as TLastOutput,
        results: results as TResults,
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
        failedAt: 'orchestrator',
      };
    }
  }

  private async rollback(
    executedSteps: Array<{
      name: string;
      output: unknown;
      rollback?: RollbackFunction<unknown>;
    }>
  ): Promise<void> {
    for (let i = executedSteps.length - 1; i >= 0; i--) {
      const step = executedSteps[i];
      if (step.rollback) {
        try {
          await step.rollback(step.output);
        } catch (error) {
          console.error(`Rollback failed for ${step.name}:`, error);
        }
      }
    }
  }
}

// Factory function
function createSaga(): SagaBuilder<Record<string, never>, undefined> {
  return new SagaBuilder();
}
