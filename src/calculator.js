const tokenPattern = /\s*(?:(\d+(?:\.\d+)?)|([+\-*/%^()]))\s*/gy;

export function calculate(expression) {
  if (!expression || expression.length > 200) {
    throw new Error('Enter a calculation with at most 200 characters.');
  }

  const tokens = tokenize(expression.trim());
  let position = 0;

  const peek = () => tokens[position];
  const consume = () => tokens[position++];

  function parseExpression() {
    let value = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = consume();
      const right = parseUnary();
      if ((operator === '/' || operator === '%') && right === 0) {
        throw new Error('Cannot divide by zero.');
      }
      if (operator === '*') value *= right;
      if (operator === '/') value /= right;
      if (operator === '%') value %= right;
    }
    return value;
  }

  function parsePower() {
    let value = parsePrimary();
    if (peek() === '^') {
      consume();
      value = value ** parseUnary();
    }
    return value;
  }

  function parseUnary() {
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    return parsePower();
  }

  function parsePrimary() {
    const token = consume();
    if (typeof token === 'number') return token;
    if (token === '(') {
      const value = parseExpression();
      if (consume() !== ')') throw new Error('Unmatched parenthesis.');
      return value;
    }
    throw new Error('Expected a number or opening parenthesis.');
  }

  const result = parseExpression();
  if (position !== tokens.length || !Number.isFinite(result)) {
    throw new Error('Invalid or unsupported calculation.');
  }
  return result;
}

function tokenize(expression) {
  const tokens = [];
  let position = 0;
  while (position < expression.length) {
    tokenPattern.lastIndex = position;
    const match = tokenPattern.exec(expression);
    if (!match || match.index !== position) {
      throw new Error('Only numbers, arithmetic operators, and parentheses are allowed.');
    }
    tokens.push(match[1] ? Number(match[1]) : match[2]);
    position = tokenPattern.lastIndex;
  }
  return tokens;
}
