// Orbit parameter descriptors: the single source for the Generator panel's
// controls and for validating presets. Pure data, so it can be used in tests.

export const DIRECTIONS = ['cw', 'ccw', 'mixed', 'alternate'];
export const TRAIL_STYLES = ['line', 'dots'];
export const NODE_STYLES = ['sphere', 'ring', 'diamond', 'orb'];

export const MAX_NODES = 16;
export const MAX_ORBIT_RADIUS = 6;

export const DEFAULT_SPEED_RATIOS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5];

/**
 * `group` places the control in the Generator panel; selects whose options
 * come from a plugin registry are filled in by OrbitalNodes.getParams().
 */
export const ORBIT_PARAMS = [
  { key: 'nodeCount', label: 'Nodes', type: 'range', min: 2, max: MAX_NODES, step: 1, group: 'orbit',
    help: 'How many nodes travel around this orbit.' },
  { key: 'radius', label: 'Radius', type: 'range', min: 0.5, max: MAX_ORBIT_RADIUS, step: 0.1, group: 'orbit' },
  { key: 'motionAlgorithm', label: 'Motion', type: 'select', group: 'motion',
    help: 'How node speeds change over time. None keeps each node at a fixed multiple of Node Speed.' },
  { key: 'baseSpeed', label: 'Node Speed', type: 'range', min: 0.05, max: 5, step: 0.05, group: 'motion' },
  { key: 'direction', label: 'Direction', type: 'select', options: DIRECTIONS, group: 'motion',
    optionLabels: { cw: 'Clockwise', ccw: 'Counter-clockwise', mixed: 'Mixed', alternate: 'Alternate' } },
  { key: 'triggerMethod', label: 'Trigger', type: 'select', group: 'trigger',
    help: 'What makes a note sound: nodes crossing each other, nodes passing fixed pins, or nodes entering zones.' },
  { key: 'noteMapping', label: 'Pitch From', type: 'select', group: 'notes',
    help: 'What decides which note in the scale plays.' },
  { key: 'trailLength', label: 'Trail Length', type: 'range', min: 0, max: 200, step: 1, group: 'look' },
  { key: 'trailStyle', label: 'Trail Style', type: 'select', options: TRAIL_STYLES, group: 'look',
    optionLabels: { line: 'Line', dots: 'Dots' } },
  { key: 'tailLength', label: 'Tail Length', type: 'range', min: 0, max: 3, step: 0.05, group: 'look' },
  { key: 'tailDecompose', label: 'Tail Break-up', type: 'range', min: 0, max: 1, step: 0.01, group: 'look' },
  { key: 'tailDecomposeCount', label: 'Tail Fragments', type: 'range', min: 2, max: 12, step: 1, group: 'look' },
  { key: 'nodeStyle', label: 'Node Style', type: 'select', options: NODE_STYLES, group: 'look',
    optionLabels: { sphere: 'Sphere', ring: 'Ring', diamond: 'Diamond', orb: 'Orb' } },
  { key: 'nodeSize', label: 'Node Size', type: 'range', min: 0.05, max: 0.5, step: 0.01, group: 'look' },
  { key: 'showOrbitRing', label: 'Orbit Ring', type: 'toggle', group: 'look' },
  { key: 'showConnectionLines', label: 'Connections', type: 'toggle', group: 'look' },
];

export const PARAM_GROUPS = [
  { id: 'orbit', label: 'Orbit' },
  { id: 'motion', label: 'Motion' },
  { id: 'trigger', label: 'Trigger' },
  { id: 'notes', label: 'Notes' },
  { id: 'look', label: 'Look' },
];
