import { isDeepStrictEqual } from "node:util";

type TestCase = {
  name: string;
  fn: () => unknown | Promise<unknown>;
};

const tests: TestCase[] = [];
const suiteStack: string[] = [];

function format(value: unknown) {
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

function createMatchers(actual: unknown, negate = false) {
  function assert(condition: boolean, message: string) {
    const passed = negate ? !condition : condition;
    if (!passed) {
      throw new Error(negate ? `Expected negation failed: ${message}` : message);
    }
  }

  return {
    toBe(expected: unknown) {
      assert(Object.is(actual, expected), `Expected ${format(actual)} to be ${format(expected)}`);
    },
    toEqual(expected: unknown) {
      assert(isDeepStrictEqual(actual, expected), `Expected ${format(actual)} to equal ${format(expected)}`);
    },
    toContain(expected: unknown) {
      if (typeof actual === "string") {
        assert(actual.includes(String(expected)), `Expected ${format(actual)} to contain ${format(expected)}`);
        return;
      }
      if (Array.isArray(actual)) {
        assert(actual.some((item) => isDeepStrictEqual(item, expected)), `Expected array to contain ${format(expected)}`);
        return;
      }
      throw new Error(`toContain is unsupported for ${typeof actual}`);
    },
    toBeGreaterThan(expected: number) {
      assert(typeof actual === "number" && actual > expected, `Expected ${format(actual)} to be greater than ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      assert(typeof actual === "number" && actual >= expected, `Expected ${format(actual)} to be greater than or equal to ${expected}`);
    },
    toBeDefined() {
      assert(actual !== undefined, `Expected value to be defined`);
    },
    toHaveLength(expected: number) {
      const actualLength = (actual as { length?: unknown })?.length;
      assert(typeof actualLength === "number" && actualLength === expected, `Expected length ${actualLength} to be ${expected}`);
    },
    get not() {
      return createMatchers(actual, !negate);
    },
  };
}

export function describe(name: string, fn: () => void) {
  suiteStack.push(name);
  try {
    fn();
  } finally {
    suiteStack.pop();
  }
}

export function it(name: string, fn: () => unknown | Promise<unknown>) {
  tests.push({
    name: [...suiteStack, name].join(" > "),
    fn,
  });
}

export const test = it;
export const expect = (actual: unknown) => createMatchers(actual);

export async function runRegisteredTests() {
  let passed = 0;
  let failed = 0;

  for (const entry of tests) {
    try {
      await entry.fn();
      passed += 1;
      console.log(`PASS ${entry.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${entry.name}`);
      console.error(error instanceof Error ? error.stack ?? error.message : error);
    }
  }

  console.log(`\nTest summary: ${passed} passed, ${failed} failed, ${tests.length} total`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}