/**
 * ChampionRegistry - Registro central de campeões.
 * Mantém todas as configurações de campeões disponíveis no jogo.
 * Permite registrar, obter e listar campeões de forma centralizada.
 */
export class ChampionRegistry {
  constructor() {
    this._champions = new Map();
  }

  /**
   * Registra um campeão no sistema.
   * @param {ChampionConfig} config - Configuração do campeão
   */
  register(config) {
    if (!config || !config.alias) {
      throw new Error("ChampionRegistry: config must have an alias");
    }
    this._champions.set(config.alias, config);
  }

  /**
   * Registra múltiplos campeões de uma vez.
   * @param {ChampionConfig[]} configs - Lista de configurações
   */
  registerAll(configs) {
    for (const config of configs) {
      this.register(config);
    }
  }

  /**
   * Obtém a configuração de um campeão pelo alias.
   * @param {string} alias - Alias do campeão
   * @returns {ChampionConfig|null} A configuração ou null se não encontrada
   */
  get(alias) {
    return this._champions.get(alias) || null;
  }

  /**
   * Verifica se um campeão está registrado.
   * @param {string} alias - Alias do campeão
   * @returns {boolean}
   */
  has(alias) {
    return this._champions.has(alias);
  }

  /**
   * Remove um campeão do registro.
   * @param {string} alias - Alias do campeão
   * @returns {boolean} True se foi removido
   */
  unregister(alias) {
    return this._champions.delete(alias);
  }

  /**
   * Retorna todos os campeões registrados.
   * @returns {ChampionConfig[]}
   */
  getAll() {
    return Array.from(this._champions.values());
  }

  /** Retorna o número de campeões registrados */
  get count() {
    return this._champions.size;
  }

  /** Limpa todos os campeões */
  clear() {
    this._champions.clear();
  }
}

export const championRegistry = new ChampionRegistry();
