import type { Greeting, GreetingQuery } from '@repo/contracts';

export function createGreeting({ name }: GreetingQuery): Greeting {
  return {
    message: `Hello, ${name}! Welcome to Voice to Warehouse.`,
    generatedAt: new Date().toISOString(),
  };
}
