let idCounter = 0;

export const generateId = () => `${++idCounter}`;

export function resetIdCounter() {
  idCounter = 0;
}
