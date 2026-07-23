const ReactDOM = require('react-dom');

function createRoot(container) {
  return {
    render(element) {
      ReactDOM.render(element, container);
    },
    unmount() {
      ReactDOM.unmountComponentAtNode(container);
    },
  };
}

function hydrateRoot(container, element) {
  ReactDOM.hydrate(element, container);
  return createRoot(container);
}

module.exports = { createRoot, hydrateRoot };
