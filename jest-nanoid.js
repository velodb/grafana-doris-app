let nextId = 0;

function nanoid() {
  nextId += 1;
  return `test-id-${nextId}`;
}

module.exports = { nanoid };
