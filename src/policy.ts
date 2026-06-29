// Política de búsqueda INYECTABLE. Una política puede aprender qué ops aparecen en soluciones verificadas y sesgar
// el orden de enumeración (búsqueda guiada, $0). Como librería pura arrancamos NEUTROS (score 0 → orden por
// relevancia de firma + recencia), pero el consumidor puede inyectar su propio sesgo aprendido vía
// `configureSearch({ scoreOp })` (p.ej. estadísticas de su propio uso). Este módulo es el punto de inyección.
let scorer: (name: string) => number = () => 0;

/** Inyecta un sesgo de ranking (op→peso histórico). Mayor peso = el buscador la prueba antes. */
export function setOpScorer(fn: (name: string) => number): void { scorer = fn; }

export const policy = {
  score(name: string): number { return scorer(name); },
  credit(_names: string[]): void { /* no-op: el aprendizaje de política vive en el consumidor */ },
};
