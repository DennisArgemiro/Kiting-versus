/**
 * Gerenciador de estado global do jogo.
 * Centraliza o estado compartilhado entre todos os modos de jogo,
 * eliminando a necessidade de estado duplicado em cada modo.
 */
export class GameState {
  constructor() {
    /** Sessão ativa do modo de treino (drill) */
    this.session = null;
    /** Sessão ativa do modo arena */
    this.arenaSession = null;
    /** Lista de campeões disponíveis */
    this.champions = [];
    /** Campeões brutos (sem overrides aplicados) */
    this.rawChampions = [];
    /** Dados do kitingVersus (snapshot de níveis reais) */
    this.kitingVersus = null;
    /** Lista de drills disponíveis */
    this.drills = [];
    /** Mapa de drills por ID */
    this.byId = new Map();
    /** Filtro atual de drills */
    this.filter = "all";
    /** Configuração do jogo (referência ao módulo config) */
    this.config = null;
    /** Estado do socket online */
    this.socket = null;
    this.onlineRoom = null;
    this.onlineOpponent = null;
    this.onlineConnected = false;
    this.onlineLobbyActive = false;
    this.onlineLobbyTimer = 0;
    this.adminAuthenticated = false;
    /** Última configuração da arena (para rematch) */
    this.lastArenaSettings = null;
    /** Referência à instância do admin */
    this.admin = null;
  }

  /** Retorna a sessão ativa (drill ou arena) */
  getActiveSession() {
    return this.session || this.arenaSession;
  }

  /** Verifica se há alguma sessão ativa */
  hasActiveSession() {
    return !!(this.session || this.arenaSession);
  }

  /**
   * Obtém a instância singleton do estado.
   * Mantém compatibilidade com o padrão `GameState.getInstance()` usado
   * pelos modos.
   */
  static getInstance() {
    return gameState;
  }
}

export const gameState = new GameState();
