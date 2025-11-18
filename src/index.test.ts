import { createSaga } from './index';

describe('Saga Pattern', () => {
  describe('Basic functionality', () => {
    it('should execute a single step successfully', async () => {
      const result = await createSaga()
        .step(
          'step1',
          { value: 10 },
          async (input) => {
            return { result: input.value * 2 };
          }
        )
        .run();

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.data).toEqual({ result: 20 });
        expect(result.results.step1).toEqual({ result: 20 });
      }
    });

    it('should execute multiple steps in sequence', async () => {
      const result = await createSaga()
        .step(
          'step1',
          { value: 10 },
          async (input) => {
            return { result: input.value * 2 };
          }
        )
        .step(
          'step2',
          { multiplier: 3 },
          async (input, ctx) => {
            return { final: ctx.results.step1.result * input.multiplier };
          }
        )
        .run();

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.data).toEqual({ final: 60 });
        expect(result.results.step1).toEqual({ result: 20 });
        expect(result.results.step2).toEqual({ final: 60 });
      }
    });

    it('should pass context with all previous results', async () => {
      const result = await createSaga()
        .step(
          'createUser',
          { email: 'test@test.com', name: 'John' },
          async (input) => {
            return { userId: 1, email: input.email };
          }
        )
        .step(
          'sendEmail',
          { template: 'welcome' as const },
          async (input, ctx) => {
            expect(ctx.results.createUser).toEqual({ userId: 1, email: 'test@test.com' });
            return { emailId: 'email-123', sentAt: new Date('2024-01-01') };
          }
        )
        .step(
          'createSubscription',
          { plan: 'premium' },
          async (input, ctx) => {
            expect(ctx.results.createUser.userId).toBe(1);
            expect(ctx.results.sendEmail.emailId).toBe('email-123');
            return { subscriptionId: 'sub-456' };
          }
        )
        .run();

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results.createUser.userId).toBe(1);
        expect(result.results.sendEmail.emailId).toBe('email-123');
        expect(result.results.createSubscription.subscriptionId).toBe('sub-456');
      }
    });
  });

  describe('Error handling and rollback', () => {
    it('should rollback all steps on failure', async () => {
      const rollbackCalls: string[] = [];

      const result = await createSaga()
        .step(
          'step1',
          { value: 1 },
          async (input) => {
            return { id: input.value };
          },
          async (output) => {
            rollbackCalls.push(`step1-rollback-${output.id}`);
          }
        )
        .step(
          'step2',
          { value: 2 },
          async (input) => {
            return { id: input.value };
          },
          async (output) => {
            rollbackCalls.push(`step2-rollback-${output.id}`);
          }
        )
        .step(
          'step3',
          { value: 3 },
          async () => {
            throw new Error('Step 3 failed');
          },
          async () => {
            rollbackCalls.push('step3-rollback');
          }
        )
        .run();

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.error.message).toBe('Step 3 failed');
        expect(result.failedAt).toBe('step3');
      }

      // Rollback should happen in reverse order
      expect(rollbackCalls).toEqual(['step2-rollback-2', 'step1-rollback-1']);
    });

    it('should handle steps without rollback functions', async () => {
      const rollbackCalls: string[] = [];

      const result = await createSaga()
        .step(
          'step1',
          { value: 1 },
          async (input) => {
            return { id: input.value };
          },
          async (output) => {
            rollbackCalls.push(`step1-rollback-${output.id}`);
          }
        )
        .step(
          'step2',
          { value: 2 },
          async (input) => {
            return { id: input.value };
          }
          // No rollback function
        )
        .step(
          'step3',
          { value: 3 },
          async () => {
            throw new Error('Step 3 failed');
          }
        )
        .run();

      expect(result.status).toBe('failed');
      // Only step1 should be rolled back (step2 has no rollback)
      expect(rollbackCalls).toEqual(['step1-rollback-1']);
    });

    it('should continue rollback even if one rollback fails', async () => {
      const rollbackCalls: string[] = [];
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await createSaga()
        .step(
          'step1',
          { value: 1 },
          async (input) => {
            return { id: input.value };
          },
          async (output) => {
            rollbackCalls.push(`step1-rollback-${output.id}`);
          }
        )
        .step(
          'step2',
          { value: 2 },
          async (input) => {
            return { id: input.value };
          },
          async () => {
            rollbackCalls.push('step2-rollback-started');
            throw new Error('Rollback failed');
          }
        )
        .step(
          'step3',
          { value: 3 },
          async () => {
            throw new Error('Step 3 failed');
          }
        )
        .run();

      expect(result.status).toBe('failed');
      expect(rollbackCalls).toEqual(['step2-rollback-started', 'step1-rollback-1']);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Rollback failed for step2:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should return error with non-Error thrown values', async () => {
      const result = await createSaga()
        .step(
          'step1',
          { value: 1 },
          async () => {
            throw 'String error';
          }
        )
        .run();

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('String error');
        expect(result.failedAt).toBe('step1');
      }
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle user registration saga', async () => {
      const db = {
        users: new Map<number, { id: number; email: string; name: string }>(),
        createUser: async (data: { email: string; name: string }) => {
          const id = Date.now();
          const user = { id, ...data };
          db.users.set(id, user);
          return user;
        },
        deleteUser: async (id: number) => {
          db.users.delete(id);
        },
      };

      const emailService = {
        sent: new Set<string>(),
        send: async (data: { to: string; template: string }) => {
          const id = `email-${Date.now()}`;
          emailService.sent.add(id);
          return id;
        },
        cancel: async (id: string) => {
          emailService.sent.delete(id);
        },
      };

      const result = await createSaga()
        .step(
          'createUser',
          { email: 'test@test.com', name: 'John' },
          async (input) => {
            const user = await db.createUser(input);
            return { userId: user.id, email: input.email };
          },
          async (output) => {
            await db.deleteUser(output.userId);
          }
        )
        .step(
          'sendEmail',
          { template: 'welcome' as const },
          async (input, ctx) => {
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

      expect(result.status).toBe('success');
      expect(db.users.size).toBe(1);
      expect(emailService.sent.size).toBe(1);
    });

    it('should handle payment processing saga with rollback', async () => {
      const stripe = {
        charges: new Map<string, { id: string; amount: number }>(),
        createCharge: async (data: { amount: number; source: string }) => {
          const id = `ch_${Date.now()}`;
          stripe.charges.set(id, { id, amount: data.amount });
          return { id };
        },
        refund: async (chargeId: string) => {
          stripe.charges.delete(chargeId);
        },
      };

      const result = await createSaga()
        .step(
          'validateCard',
          { cardToken: 'tok_visa' },
          async (input) => {
            return { cardId: input.cardToken, last4: '4242' };
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
            const charge = await stripe.createCharge({
              amount: ctx.results.calculateTotal.total,
              source: ctx.results.validateCard.cardId,
            });
            return { chargeId: charge.id };
          },
          async (output) => {
            await stripe.refund(output.chargeId);
          }
        )
        .step(
          'sendReceipt',
          { recipientEmail: 'user@example.com' },
          async () => {
            throw new Error('Email service unavailable');
          }
        )
        .run();

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.failedAt).toBe('sendReceipt');
      }
      // Charge should be refunded
      expect(stripe.charges.size).toBe(0);
    });
  });

  describe('Type safety', () => {
    it('should provide type-safe access to step results', async () => {
      const result = await createSaga()
        .step(
          'step1',
          { value: 'hello' },
          async (input) => {
            return { text: input.value.toUpperCase() };
          }
        )
        .step(
          'step2',
          { suffix: '!' },
          async (input, ctx) => {
            // TypeScript should know that ctx.results.step1.text is a string
            const text: string = ctx.results.step1.text;
            return { final: text + input.suffix };
          }
        )
        .run();

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results.step1.text).toBe('HELLO');
        expect(result.results.step2.final).toBe('HELLO!');
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty saga', async () => {
      const result = await createSaga().run();

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.data).toBeUndefined();
        expect(result.results).toEqual({});
      }
    });

    it('should handle async operations in steps', async () => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      const result = await createSaga()
        .step(
          'step1',
          { delay: 10 },
          async (input) => {
            await delay(input.delay);
            return { completed: true };
          }
        )
        .step(
          'step2',
          { delay: 20 },
          async (input) => {
            await delay(input.delay);
            return { completed: true };
          }
        )
        .run();

      expect(result.status).toBe('success');
    });

    it('should handle steps returning null or undefined', async () => {
      const result = await createSaga()
        .step(
          'step1',
          { value: 1 },
          async () => {
            return null as unknown as { value: null };
          }
        )
        .step(
          'step2',
          { value: 2 },
          async () => {
            return undefined as unknown as { value: undefined };
          }
        )
        .run();

      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(result.results.step1).toBeNull();
        expect(result.results.step2).toBeUndefined();
      }
    });
  });

  describe('Nested sagas with rollback', () => {
    it('should rollback nested saga using returned rollback function', async () => {
      const actions: string[] = [];

      const innerSagaResult = await createSaga()
        .step(
          'innerStep1',
          {},
          async () => {
            actions.push('innerStep1-execute');
            return { value: 1 };
          },
          async () => {
            actions.push('innerStep1-rollback');
          }
        )
        .step(
          'innerStep2',
          {},
          async () => {
            actions.push('innerStep2-execute');
            return { value: 2 };
          },
          async () => {
            actions.push('innerStep2-rollback');
          }
        )
        .run();

      expect(innerSagaResult.status).toBe('success');
      expect(actions).toEqual(['innerStep1-execute', 'innerStep2-execute']);

      // Now roll back the entire inner saga
      if (innerSagaResult.status === 'success') {
        await innerSagaResult.rollback();
      }

      expect(actions).toEqual([
        'innerStep1-execute',
        'innerStep2-execute',
        'innerStep2-rollback',
        'innerStep1-rollback',
      ]);
    });

    it('should use nested saga rollback in outer saga compensation', async () => {
      const actions: string[] = [];

      const result = await createSaga()
        .step(
          'runInnerWorkflow',
          {},
          async () => {
            const innerResult = await createSaga()
              .step(
                'createResource',
                {},
                async () => {
                  actions.push('inner-createResource');
                  return { id: 123 };
                },
                async () => {
                  actions.push('inner-rollback-createResource');
                }
              )
              .step(
                'configureResource',
                {},
                async () => {
                  actions.push('inner-configureResource');
                  return { configured: true };
                },
                async () => {
                  actions.push('inner-rollback-configureResource');
                }
              )
              .run();

            if (innerResult.status === 'failed') {
              throw new Error('Inner saga failed');
            }

            return {
              innerResults: innerResult.results,
              innerRollback: innerResult.rollback,
            };
          },
          async (output) => {
            // Rollback the entire inner saga
            actions.push('outer-rollback-triggered');
            await output.innerRollback();
          }
        )
        .step(
          'outerStep2',
          {},
          async () => {
            actions.push('outer-step2');
            throw new Error('Outer step failed');
          }
        )
        .run();

      expect(result.status).toBe('failed');
      expect(actions).toEqual([
        'inner-createResource',
        'inner-configureResource',
        'outer-step2',
        'outer-rollback-triggered',
        'inner-rollback-configureResource',
        'inner-rollback-createResource',
      ]);
    });
  });
});
