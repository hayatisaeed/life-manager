// Enforces logical (direction-agnostic) styling so layouts mirror correctly in RTL.
// See docs/DESIGN.md §8.

/**
 * Tailwind physical utility → logical replacement. Order matters: longer prefixes first.
 * @type {[RegExp, (m: RegExpMatchArray) => string][]}
 */
const CLASS_RULES = [
  [/^scroll-m([lr])-/, (m) => `scroll-m${m[1] === 'l' ? 's' : 'e'}-`],
  [/^scroll-p([lr])-/, (m) => `scroll-p${m[1] === 'l' ? 's' : 'e'}-`],
  [/^m([lr])-/, (m) => `m${m[1] === 'l' ? 's' : 'e'}-`],
  [/^p([lr])-/, (m) => `p${m[1] === 'l' ? 's' : 'e'}-`],
  [/^(left|right)-/, (m) => (m[1] === 'left' ? 'start-' : 'end-')],
  [/^border-([lr])(?=-|$)/, (m) => `border-${m[1] === 'l' ? 's' : 'e'}`],
  [/^rounded-([lr])(?=-|$)/, (m) => `rounded-${m[1] === 'l' ? 's' : 'e'}`],
  [
    /^rounded-(tl|tr|bl|br)(?=-|$)/,
    (m) => `rounded-${{ tl: 'ss', tr: 'se', bl: 'es', br: 'ee' }[m[1] ?? 'tl']}`,
  ],
  [/^text-(left|right)$/, (m) => (m[1] === 'left' ? 'text-start' : 'text-end')],
  [/^float-(left|right)$/, (m) => (m[1] === 'left' ? 'float-start' : 'float-end')],
  [/^clear-(left|right)$/, (m) => (m[1] === 'left' ? 'clear-start' : 'clear-end')],
];

/** Inline-style (camelCase) physical properties → logical replacement. */
const STYLE_PROPS = {
  marginLeft: 'marginInlineStart',
  marginRight: 'marginInlineEnd',
  paddingLeft: 'paddingInlineStart',
  paddingRight: 'paddingInlineEnd',
  left: 'insetInlineStart',
  right: 'insetInlineEnd',
  borderLeft: 'borderInlineStart',
  borderRight: 'borderInlineEnd',
  borderLeftWidth: 'borderInlineStartWidth',
  borderRightWidth: 'borderInlineEndWidth',
  borderLeftColor: 'borderInlineStartColor',
  borderRightColor: 'borderInlineEndColor',
  borderTopLeftRadius: 'borderStartStartRadius',
  borderTopRightRadius: 'borderStartEndRadius',
  borderBottomLeftRadius: 'borderEndStartRadius',
  borderBottomRightRadius: 'borderEndEndRadius',
};
const STYLE_VALUE_PROPS = new Set(['textAlign', 'float', 'clear']);

/** Functions whose string arguments are class lists. */
const CLASS_FUNCTIONS = new Set(['cn', 'clsx', 'cx', 'cva', 'tv', 'twMerge', 'twJoin']);

/**
 * Returns the logical replacement for a single Tailwind class token, or null if it is fine.
 * Variants (`md:`, `rtl:`, `hover:`), the important modifier and negative prefix are preserved.
 * @param {string} token
 * @returns {string | null}
 */
export function logicalClassFor(token) {
  const parts = token.split(':');
  const utility = parts.pop() ?? '';
  // Explicit direction variants are a deliberate, direction-aware choice.
  if (parts.includes('rtl') || parts.includes('ltr')) return null;
  const important = utility.startsWith('!') ? '!' : '';
  const rest = utility.slice(important.length);
  const negative = rest.startsWith('-') ? '-' : '';
  const base = rest.slice(negative.length);
  for (const [re, fix] of CLASS_RULES) {
    const m = base.match(re);
    if (m) {
      const replaced = base.replace(re, fix(m));
      return [...parts, `${important}${negative}${replaced}`].join(':');
    }
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow physical left/right styling; use logical (start/end) equivalents.',
    },
    messages: {
      cls: "Physical class '{{bad}}' breaks RTL; use '{{good}}'.",
      prop: "Physical style '{{bad}}' breaks RTL; use '{{good}}'.",
      value: "'{{prop}}: {{bad}}' breaks RTL; use '{{good}}'.",
    },
    schema: [],
  },
  create(context) {
    /** @param {any} node @param {string} text */
    function checkClassString(node, text) {
      for (const token of text.split(/\s+/)) {
        if (!token) continue;
        const good = logicalClassFor(token);
        if (good) context.report({ node, messageId: 'cls', data: { bad: token, good } });
      }
    }

    /** Walks an expression that produces class names. @param {any} node */
    function checkClassExpression(node) {
      if (!node) return;
      switch (node.type) {
        case 'Literal':
          if (typeof node.value === 'string') checkClassString(node, node.value);
          break;
        case 'TemplateLiteral':
          for (const q of node.quasis) checkClassString(q, q.value.cooked ?? '');
          for (const e of node.expressions) checkClassExpression(e);
          break;
        case 'ConditionalExpression':
          checkClassExpression(node.consequent);
          checkClassExpression(node.alternate);
          break;
        case 'LogicalExpression':
          checkClassExpression(node.right);
          break;
        case 'ArrayExpression':
          for (const el of node.elements) checkClassExpression(el);
          break;
        case 'ObjectExpression':
          for (const p of node.properties) {
            if (p.type !== 'Property') continue;
            if (p.key.type === 'Literal' && typeof p.key.value === 'string') {
              checkClassString(p.key, p.key.value);
            } else if (p.key.type === 'Identifier' && !p.computed) {
              checkClassString(p.key, p.key.name);
            }
            // cva/tv variant maps nest class strings as values.
            checkClassExpression(p.value);
          }
          break;
        // Class-function calls (cn, clsx, …) are checked by the CallExpression visitor,
        // so skipping them here avoids duplicate reports.
        case 'JSXExpressionContainer':
          checkClassExpression(node.expression);
          break;
        default:
          break;
      }
    }

    /** @param {any} node */
    function checkCall(node) {
      const callee = node.callee;
      const name = callee.type === 'Identifier' ? callee.name : null;
      if (name && CLASS_FUNCTIONS.has(name)) {
        for (const arg of node.arguments) checkClassExpression(arg);
      }
    }

    /** @param {any} obj */
    function checkStyleObject(obj) {
      if (obj?.type !== 'ObjectExpression') return;
      for (const p of obj.properties) {
        if (p.type !== 'Property' || p.computed) continue;
        const key =
          p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? p.key.value : null;
        if (typeof key !== 'string') continue;
        const good = STYLE_PROPS[/** @type {keyof typeof STYLE_PROPS} */ (key)];
        if (good) {
          context.report({ node: p.key, messageId: 'prop', data: { bad: key, good } });
        } else if (
          STYLE_VALUE_PROPS.has(key) &&
          p.value.type === 'Literal' &&
          (p.value.value === 'left' || p.value.value === 'right')
        ) {
          const goodValue = p.value.value === 'left' ? 'start' : 'end';
          const prefix = key === 'textAlign' ? '' : 'inline-';
          context.report({
            node: p.value,
            messageId: 'value',
            data: { prop: key, bad: p.value.value, good: `${prefix}${goodValue}` },
          });
        }
      }
    }

    return {
      /** @param {any} node */
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        if (name === 'className' || name === 'class') {
          checkClassExpression(node.value);
        } else if (name === 'style' && node.value?.type === 'JSXExpressionContainer') {
          checkStyleObject(node.value.expression);
        }
      },
      /** @param {any} node */
      CallExpression(node) {
        checkCall(node);
      },
    };
  },
};

export default rule;
