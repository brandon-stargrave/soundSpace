import { NodeCollision } from './NodeCollision.js';
import { StaticPins } from './StaticPins.js';
import { ZoneTriggers } from './ZoneTriggers.js';

const TRIGGERS = {
  nodeCollision: { name: 'Node Collision', factory: () => new NodeCollision() },
  staticPins:    { name: 'Static Pins', factory: () => new StaticPins() },
  zoneTriggers:  { name: 'Zone Triggers', factory: () => new ZoneTriggers() },
};

export function getTriggerIds() {
  return Object.keys(TRIGGERS);
}

export function getTriggerNames() {
  return Object.entries(TRIGGERS).map(([id, { name }]) => ({ id, name }));
}

export function createTrigger(id) {
  const entry = TRIGGERS[id];
  if (!entry) throw new Error(`Unknown trigger method: ${id}`);
  return entry.factory();
}
