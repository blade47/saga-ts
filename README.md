# saga-ts

A lightweight, type-safe saga pattern implementation for TypeScript with automatic rollback support.

## Features

- **Type-safe**: Full TypeScript support with intelligent type inference
- **Automatic rollback**: Failed steps trigger automatic compensation in reverse order
- **Zero dependencies**: Lightweight and production-ready
- **Simple API**: Intuitive builder pattern for defining sagas
- **Flexible**: Works with any async operations (database, API calls, etc.)

## Installation

```bash
npm install saga-ts
```

## Quick Start

```typescript
import { createSaga } from 'saga-ts';

const result = await createSaga()
  .step(
    'createUser',
    { email: 'test@test.com', name: 'John' },
    async (input, ctx) => {
      const user = await db.users.create(input);
      return { userId: user.id, email: input.email };
    },
    async (output) => {
      // Rollback: delete the user if something fails later
      await db.users.delete(output.userId);
    }
  )
  .step(
    'sendEmail',
    { template: 'welcome' },
    async (input, ctx) => {
      // Access previous step results with full type safety
      const { email } = ctx.results.createUser;

      const emailId = await emailService.send({
        to: email,
        template: input.template,
      });
      return { emailId, sentAt: new Date() };
    },
    async (output) => {
      await emailService.cancel(output.emailId);
    }
  )
  .run();

if (result.status === 'success') {
  console.log('User created:', result.results.createUser.userId);
  console.log('Email sent:', result.results.sendEmail.emailId);
} else {
  console.error('Failed at step:', result.failedAt);
  console.error('Error:', result.error);
}
```

## API Reference

### `createSaga()`

Creates a new saga builder instance.

### `.step(name, input, execute, rollback?)`

Adds a step to the saga.

- **name**: Unique identifier for the step (used for accessing results)
- **input**: Input data for the step
- **execute**: Async function that performs the step's action
  - Receives `input` and `ctx` (containing results from previous steps)
  - Must return the step's output
- **rollback** (optional): Async function to undo the step's action
  - Receives the step's output
  - Called automatically if a later step fails

### `.run()`

Executes the saga and returns a promise with the result.

**Success result:**
```typescript
{
  status: 'success',
  data: TLastOutput,      // Output of the last step
  results: TResults       // All step results by name
}
```

**Failure result:**
```typescript
{
  status: 'failed',
  error: Error,           // The error that occurred
  failedAt: string        // Name of the step that failed
}
```

## Examples

### Payment Processing with Rollback

```typescript
const result = await createSaga()
  .step(
    'validateCard',
    { cardToken: 'tok_visa' },
    async (input) => {
      const card = await stripe.tokens.retrieve(input.cardToken);
      return { cardId: card.id, last4: card.card.last4 };
    }
  )
  .step(
    'calculateTotal',
    { items: [{ id: '1', price: 100 }, { id: '2', price: 50 }] },
    async (input) => {
      const total = input.items.reduce((sum, item) => sum + item.price, 0);
      return { total, items: input.items };
    }
  )
  .step(
    'createCharge',
    { currency: 'usd' },
    async (input, ctx) => {
      const charge = await stripe.charges.create({
        amount: ctx.results.calculateTotal.total,
        currency: input.currency,
        source: ctx.results.validateCard.cardId,
      });
      return { chargeId: charge.id };
    },
    async (output) => {
      // Rollback: refund the charge
      await stripe.refunds.create({ charge: output.chargeId });
    }
  )
  .step(
    'sendReceipt',
    { recipientEmail: 'user@example.com' },
    async (input, ctx) => {
      await emailService.send({
        to: input.recipientEmail,
        template: 'receipt',
        data: {
          chargeId: ctx.results.createCharge.chargeId,
          amount: ctx.results.calculateTotal.total,
        },
      });
      return { sent: true };
    }
  )
  .run();

// If sendReceipt fails, the charge will be automatically refunded
```

### Complex User Onboarding

```typescript
const result = await createSaga()
  .step(
    'createAccount',
    { email: 'user@example.com', password: 'secure123' },
    async (input) => {
      const account = await db.accounts.create(input);
      return { accountId: account.id };
    },
    async (output) => {
      await db.accounts.delete(output.accountId);
    }
  )
  .step(
    'createProfile',
    { name: 'John Doe', avatar: 'default.png' },
    async (input, ctx) => {
      const profile = await db.profiles.create({
        ...input,
        accountId: ctx.results.createAccount.accountId,
      });
      return { profileId: profile.id };
    },
    async (output) => {
      await db.profiles.delete(output.profileId);
    }
  )
  .step(
    'assignRole',
    { role: 'user' },
    async (input, ctx) => {
      await db.roles.assign({
        accountId: ctx.results.createAccount.accountId,
        role: input.role,
      });
      return { role: input.role };
    },
    async (output, ctx) => {
      await db.roles.revoke({
        accountId: ctx.results.createAccount.accountId,
        role: output.role,
      });
    }
  )
  .step(
    'sendWelcomeEmail',
    { template: 'onboarding' },
    async (input, ctx) => {
      const emailId = await emailService.send({
        to: ctx.results.createAccount.email,
        template: input.template,
      });
      return { emailId };
    }
  )
  .run();
```

## How It Works

1. **Step Execution**: Steps are executed sequentially in the order they're defined
2. **Context Propagation**: Each step receives results from all previous steps via `ctx.results`
3. **Type Safety**: TypeScript automatically infers and validates the types of step inputs and outputs
4. **Error Handling**: If any step throws an error, execution stops immediately
5. **Automatic Rollback**: Compensation functions are called in reverse order for all successfully executed steps
6. **Rollback Resilience**: If a rollback fails, an error is logged but other rollbacks continue

## Type Safety

saga-ts provides full type inference:

```typescript
const result = await createSaga()
  .step('step1', { value: 10 }, async (input) => {
    return { doubled: input.value * 2 };
  })
  .step('step2', { multiplier: 3 }, async (input, ctx) => {
    // TypeScript knows ctx.results.step1.doubled is a number
    const result = ctx.results.step1.doubled * input.multiplier;
    return { final: result };
  })
  .run();

if (result.status === 'success') {
  // TypeScript knows the exact shape of results
  const doubled: number = result.results.step1.doubled;
  const final: number = result.results.step2.final;
}
```

## Error Handling Best Practices

1. **Always provide rollback functions** for steps that modify state
2. **Keep rollbacks idempotent** - they may be called multiple times
3. **Log rollback failures** - the library logs them but continues
4. **Test your rollback logic** - ensure compensations work correctly

## Known Limitations

This library is designed for simplicity and type safety. For more complex orchestration needs, consider these limitations:

### Sequential Execution Only
Steps execute one at a time in order. If you have independent steps that could run in parallel, they will still wait for each other to complete.

```typescript
// These steps run sequentially even though they're independent
.step('fetchUserProfile', {}, async () => { /* ... */ })
.step('fetchUserPreferences', {}, async () => { /* ... */ })
```

**Workaround**: Run independent sagas concurrently using `Promise.all()`.

### No Built-in Retry Logic
If a step fails due to transient issues (network timeout, rate limiting), the entire saga fails and rolls back. There's no automatic retry with exponential backoff.

**Workaround**: Implement retry logic inside your step functions or wrap the saga execution in a retry handler.

### Limited Rollback Observability
When rollback functions fail, errors are logged to `console.error` but not included in the saga result. You won't know if compensation partially failed.

**Workaround**: Implement your own error tracking inside rollback functions if you need detailed compensation audit logs.

### In-Memory Only
All step results are stored in memory during execution. For long-running sagas or steps that return large payloads, this could cause memory issues. There's no persistence layer.

**Implication**: If your process crashes mid-saga, there's no way to resume. For critical workflows, consider workflow engines like Temporal or Conductor.

### No Conditional Logic
Every step runs unless a previous step fails. You can't skip steps based on conditions.

```typescript
// Can't do: "if user is premium, skip payment step"
```

**Workaround**: Use conditional logic inside step functions to return early, or split into separate sagas.

### No Timeout or Cancellation
Steps can run indefinitely. There's no built-in timeout mechanism or AbortSignal support.

**Workaround**: Implement timeouts within your step functions using `Promise.race()` or AbortController.

## When to Use Sagas

Sagas are ideal for:
- Multi-step business processes that need to be atomic
- Distributed transactions across services
- Complex workflows with compensation logic
- Operations that need to maintain consistency across failures

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
