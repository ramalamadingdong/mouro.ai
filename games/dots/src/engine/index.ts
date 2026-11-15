export * from './board';
export * from './types';
export { applyMove, autoEdge, boxesClosedBy, createGame, isLegalEdge, scores, winners, type NewGame } from './reducer';
export { normalize } from './serialize';
