export interface KustomizeGeneratorSchema {
  name?: string
  namespace?: string
  overlays?: string[]
  dependencies?: string[]
}
