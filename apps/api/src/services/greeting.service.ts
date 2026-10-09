import type { Greeting, GreetingQuery } from '@repo/contracts';

export function createGreeting({ name }: GreetingQuery): Greeting {
  return {
    message: `Hello, ${name}! Welcome to ANVY.`,
    generatedAt: new Date().toISOString(),
  };
}
