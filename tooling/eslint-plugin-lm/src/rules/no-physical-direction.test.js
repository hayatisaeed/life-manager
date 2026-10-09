import { RuleTester } from 'eslint';
import { describe, it, expect } from 'vitest';
import rule, { logicalClassFor } from './no-physical-direction.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe('logicalClassFor', () => {
  it.each([
    ['ml-2', 'ms-2'],
    ['pr-4', 'pe-4'],
    ['-ml-1', '-ms-1'],
    ['md:hover:pl-3', 'md:hover:ps-3'],
    ['!mr-px', '!me-px'],
    ['left-0', 'start-0'],
    ['right-1/2', 'end-1/2'],
    ['border-l', 'border-s'],
    ['border-r-2', 'border-e-2'],
    ['rounded-l-lg', 'rounded-s-lg'],
    ['rounded-tr-md', 'rounded-se-md'],
    ['text-left', 'text-start'],
    ['float-right', 'float-end'],
    ['scroll-ml-4', 'scroll-ms-4'],
  ])('%s → %s', (input, expected) => {
    expect(logicalClassFor(input)).toBe(expected);
  });

  it.each([
    'ms-2',
    'pe-4',
    'mx-2',
    'px-4',
    'border',
    'border-t',
    'rounded-lg',
    'text-center',
    'rtl:ml-2',
    'ltr:left-0',
    'leading-6',
    'line-clamp-2',
    'prose',
    'pl',
    'my-left-thing',
  ])('%s is allowed', (input) => {
    expect(logicalClassFor(input)).toBeNull();
  });
});

tester.run('no-physical-direction', rule, {
  valid: [
    '<div className="ms-2 pe-4 text-start" />',
    '<div className={cn("ps-2", active && "border-s")} />',
    '<div style={{ marginInlineStart: 8, textAlign: "start" }} />',
    'const label = "ml-2 is a string, not a class";',
    'foo("ml-2")',
    '<div className="rtl:me-2" />',
  ],
  invalid: [
    {
      code: '<div className="ml-2 text-left" />',
      errors: [{ messageId: 'cls' }, { messageId: 'cls' }],
    },
    {
      code: '<div className={`flex ${open ? "pl-2" : "pr-2"}`} />',
      errors: [{ messageId: 'cls' }, { messageId: 'cls' }],
    },
    {
      code: 'const c = cn("left-0", { "rounded-l": x }, ["mr-1"]);',
      errors: [{ messageId: 'cls' }, { messageId: 'cls' }, { messageId: 'cls' }],
    },
    {
      code: '<div className={clsx(cn("pl-1"))} />',
      errors: [{ messageId: 'cls' }],
    },
    {
      code: 'const b = cva("p-2", { variants: { side: { start: "border-l" } } });',
      errors: [{ messageId: 'cls' }],
    },
    {
      code: '<div style={{ marginLeft: 4, textAlign: "right", float: "left" }} />',
      errors: [{ messageId: 'prop' }, { messageId: 'value' }, { messageId: 'value' }],
    },
  ],
});
